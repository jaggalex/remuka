/**
 * Renewal decisions and the loop around them (ADR-247 §2.5, §3.3).
 *
 * The database is absent on purpose: what is pinned here is the calendar of §3.3 (retries
 * on days 1, 3, 7 and 13, suspension on the fourteenth, ADR-319), the letters of every
 * day from 0 to 15, the idempotency of two ticks, and the
 * rule that a charge other than an explicit success never marks a period paid.
 */
import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RENEWAL_FINAL_NOTICE_MS,
  RENEWAL_GRACE_MS,
  RENEWAL_RETRIES_MS,
  createBillingLoops,
  renewalSchedule,
  openPaymentMethodRef,
  renewalStep,
} from "./billing-renewals.mjs";
import { PLANS } from "./billing-catalog.mjs";
import { encryptSecret } from "./secrets.mjs";

const NOW = Date.parse("2026-11-20T12:00:00.000Z");
const DAY = 86_400_000;

/** An instant `days` (and `offsetMs`) after the fixed now. */
const at = (days, offsetMs = 0) => new Date(NOW + days * DAY + offsetMs);

const silent = { log() {}, warn() {}, error() {} };

function active(overrides = {}) {
  return {
    id: "sub-1",
    org_id: "org-1",
    status: "active",
    plan: "pro",
    interval: "month",
    amount: 29000,
    currency: "RUB",
    current_period_end: new Date(NOW),
    cancel_at_period_end: false,
    past_due_since: null,
    ...overrides,
  };
}

function pastDue(overrides = {}) {
  return active({ status: "past_due", past_due_since: new Date(NOW), ...overrides });
}

function invoiceFor(subscription, overrides = {}) {
  return {
    id: `inv-${subscription.id}`,
    status: "open",
    total: Number(subscription.amount),
    currency: subscription.currency,
    period_start: subscription.current_period_end,
    period_end: new Date(NOW + 31 * DAY),
    ...overrides,
  };
}

function fakeStore({ subscriptions = [], invoice = null, attempts = 0 } = {}) {
  const calls = [];
  const state = { subscriptions: [...subscriptions] };

  return {
    calls,
    state,
    async dueSubscriptions({ limit }) {
      calls.push(["dueSubscriptions", limit]);
      return state.subscriptions.filter(
        (row) => row.status === "active" || row.status === "past_due",
      );
    },
    async renewalInvoice(subscription) {
      calls.push(["renewalInvoice", subscription.id]);
      return invoice ?? invoiceFor(subscription);
    },
    async openInvoiceFor(id) {
      calls.push(["openInvoiceFor", id]);
      return invoice;
    },
    async advanceSubscription({ id, periodEnd }) {
      calls.push(["advanceSubscription", { id, periodEnd }]);
      // A successful renewal leaves the due list, exactly like the real row.
      state.subscriptions = state.subscriptions.filter((row) => row.id !== id);
      return { id, status: "active", current_period_end: periodEnd };
    },
    async markPastDue(id) {
      calls.push(["markPastDue", id]);
      return { id, status: "past_due" };
    },
    async bumpRenewalAttempts(id) {
      calls.push(["bumpRenewalAttempts", id]);
      return attempts + 1;
    },
    async renewalAttempts(id) {
      calls.push(["renewalAttempts", id]);
      return attempts;
    },
    async suspendSubscription(id) {
      calls.push(["suspendSubscription", id]);
      return { id, status: "suspended" };
    },
    async cancelSubscription(id) {
      calls.push(["cancelSubscription", id]);
      return { id, status: "canceled" };
    },
    async reconcileFrozenRooms(orgId, maxRooms) {
      calls.push(["reconcileFrozenRooms", orgId, maxRooms]);
      return 0;
    },
    async withTenant(_orgId, fn) {
      return fn();
    },
  };
}

function recorder() {
  const calls = [];
  const fn = async (type, payload) => {
    calls.push([type, payload]);
  };
  fn.calls = calls;
  return fn;
}

const loopClock = () => NOW;

describe("the renewal calendar (§3.3)", () => {
  it("offers retries on days 1, 3, 7 and 13 and a fourteen-day grace (ADR-319)", () => {
    expect(RENEWAL_RETRIES_MS).toEqual([1 * DAY, 3 * DAY, 7 * DAY, 13 * DAY]);
    expect(RENEWAL_GRACE_MS).toBe(14 * DAY);
    expect(RENEWAL_FINAL_NOTICE_MS).toBe(12 * DAY);
    expect(renewalSchedule(at(0))).toEqual({
      retries: [at(1), at(3), at(7), at(13)],
      finalNotice: at(12),
      finalAttempt: at(13),
      graceEnd: at(14),
    });
  });

  const cases = [
    {
      name: "an active subscription before its period end does nothing",
      input: { status: "active", periodEnd: at(1) },
      action: "none",
    },
    {
      name: "the exact period end is due",
      input: { status: "active", periodEnd: at(0) },
      action: "invoice",
    },
    {
      name: "one millisecond past the end is still one invoice, not a retry",
      input: { status: "active", periodEnd: at(0, -1) },
      action: "invoice",
    },
    {
      name: "cancel at period end beats the invoice",
      input: { status: "active", periodEnd: at(0), cancelAtPeriodEnd: true },
      action: "cancel",
    },
    {
      name: "cancel at period end waits for the period to end",
      input: { status: "active", periodEnd: at(1), cancelAtPeriodEnd: true },
      action: "none",
    },
    {
      name: "a trial has no renewal of its own",
      input: { status: "trialing", periodEnd: at(0) },
      action: "none",
    },
    {
      name: "a suspended subscription does not renew",
      input: { status: "suspended", periodEnd: at(0) },
      action: "none",
    },
    {
      name: "a canceled subscription does not renew",
      input: { status: "canceled", periodEnd: at(0) },
      action: "none",
    },
    {
      name: "an active row without a period end is a data bug, not a charge",
      input: { status: "active", periodEnd: null },
      action: "none",
    },
    {
      name: "past due waits one day for the first retry",
      input: { status: "past_due", pastDueSince: at(0), attempts: 0 },
      action: "none",
    },
    {
      name: "the first retry happens exactly on day one",
      input: { status: "past_due", pastDueSince: at(0), attempts: 0, now: at(1) },
      action: "retry",
    },
    {
      name: "the second retry is on day three",
      input: { status: "past_due", pastDueSince: at(0), attempts: 1, now: at(3) },
      action: "retry",
    },
    {
      name: "the third retry is on day seven",
      input: { status: "past_due", pastDueSince: at(0), attempts: 2, now: at(7) },
      action: "retry",
    },
    {
      name: "the third retry does not happen on day six",
      input: { status: "past_due", pastDueSince: at(0), attempts: 2, now: at(6) },
      action: "none",
    },
    {
      name: "day twelve announces the last retry",
      input: { status: "past_due", pastDueSince: at(0), attempts: 3, now: at(12) },
      action: "final_notice",
    },
    {
      name: "the fourth retry is on day thirteen",
      input: { status: "past_due", pastDueSince: at(0), attempts: 3, now: at(13) },
      action: "retry",
    },
    {
      name: "after the fourth retry there is nothing left before the grace ends",
      input: { status: "past_due", pastDueSince: at(0), attempts: 4, now: at(13) },
      action: "none",
    },
    {
      name: "the fourteenth day suspends even with no retry made",
      input: { status: "past_due", pastDueSince: at(0), attempts: 0, now: at(14) },
      action: "suspend",
    },
    {
      name: "suspension wins over the last retry on the same instant",
      input: { status: "past_due", pastDueSince: at(0), attempts: 3, now: at(14) },
      action: "suspend",
    },
    {
      name: "past due later than the grace is suspended",
      input: { status: "past_due", pastDueSince: at(0), attempts: 3, now: at(30) },
      action: "suspend",
    },
    {
      name: "past due without the start of its grace does nothing",
      input: { status: "past_due", pastDueSince: null, now: at(30) },
      action: "none",
    },
    {
      name: "a negative attempt count is read as zero",
      input: { status: "past_due", pastDueSince: at(0), attempts: -5, now: at(1) },
      action: "retry",
    },
    {
      name: "an unknown status does nothing",
      input: { status: "paused", periodEnd: at(-1) },
      action: "none",
    },
  ];

  for (const testCase of cases) {
    it(testCase.name, () => {
      expect(
        renewalStep({ now: testCase.input.now ?? at(0), ...testCase.input }),
      ).toEqual({ action: testCase.action });
    });
  }

  it("accepts ISO strings and epoch milliseconds as timestamps", () => {
    expect(
      renewalStep({
        status: "active",
        periodEnd: new Date(NOW).toISOString(),
        now: NOW,
      }),
    ).toEqual({ action: "invoice" });
  });
});

describe("one tick (§3.3)", () => {
  it("invoices, charges, advances the period and announces success", async () => {
    const subscription = active();
    const store = fakeStore({ subscriptions: [subscription] });
    const notify = recorder();
    const charged = [];
    const loops = createBillingLoops({
      store,
      notify,
      log: silent,
      now: loopClock,
      charge: async (request) => {
        charged.push(request);
        return { status: "succeeded" };
      },
    });

    const result = await loops.tick();

    expect(result.processed).toBe(1);
    expect(store.calls[0]).toEqual(["dueSubscriptions", 50]);
    expect(charged).toHaveLength(1);
    expect(charged[0]).toMatchObject({
      subscription,
      idempotencyKey: `invoice:inv-sub-1:attempt:1`,
      attempt: 1,
    });
    const advance = store.calls.find((call) => call[0] === "advanceSubscription");
    expect(advance[1]).toEqual({ id: "sub-1", periodEnd: invoiceFor(subscription).period_end });
    expect(notify.calls.map((call) => call[0])).toEqual(["payment_succeeded"]);
  });

  it("keeps the plan in its grace period when the charge fails", async () => {
    const subscription = active();
    const store = fakeStore({ subscriptions: [subscription] });
    const notify = recorder();
    const loops = createBillingLoops({
      store,
      notify,
      log: silent,
      now: loopClock,
      charge: async () => {
        throw Object.assign(new Error("declined"), { code: "card_declined" });
      },
    });

    const [action] = (await loops.tick()).actions;

    expect(action).toMatchObject({ status: "failed", failureCode: "card_declined" });
    expect(store.calls.some((call) => call[0] === "advanceSubscription")).toBe(false);
    expect(store.calls).toContainEqual(["markPastDue", "sub-1"]);
    expect(notify.calls).toHaveLength(1);
    expect(notify.calls[0][0]).toBe("payment_failed");
    expect(notify.calls[0][1]).toMatchObject({ failureCode: "card_declined" });
  });

  it("treats an answer without a status as a failure, never as paid", async () => {
    const store = fakeStore({ subscriptions: [active()] });
    const notify = recorder();
    const loops = createBillingLoops({
      store,
      notify,
      log: silent,
      now: loopClock,
      charge: async () => ({}),
    });

    const [action] = (await loops.tick()).actions;
    expect(action.status).toBe("failed");
    expect(store.calls).toContainEqual(["markPastDue", "sub-1"]);
  });

  it("leaves a pending charge to the webhook", async () => {
    const store = fakeStore({ subscriptions: [active()] });
    const notify = recorder();
    const loops = createBillingLoops({
      store,
      notify,
      log: silent,
      now: loopClock,
      charge: async () => ({ status: "pending" }),
    });

    const [action] = (await loops.tick()).actions;

    expect(action.status).toBe("pending");
    expect(store.calls.some((call) => call[0] === "advanceSubscription")).toBe(false);
    expect(store.calls.some((call) => call[0] === "markPastDue")).toBe(false);
    expect(notify.calls).toHaveLength(0);
  });

  it("retries the existing open invoice and counts the failure", async () => {
    const subscription = pastDue();
    const invoice = invoiceFor(subscription);
    const store = fakeStore({ subscriptions: [subscription], invoice, attempts: 1 });
    const notify = recorder();
    const charged = [];
    const loops = createBillingLoops({
      store,
      notify,
      log: silent,
      now: () => NOW + 3 * DAY,
      charge: async (request) => {
        charged.push(request);
        return { status: "failed", failureCode: "insufficient_funds" };
      },
    });

    const [action] = (await loops.tick()).actions;

    expect(store.calls).toContainEqual(["openInvoiceFor", "sub-1"]);
    // One failed retry is behind; this is the second retry, the third charge of the invoice.
    expect(charged[0].idempotencyKey).toBe("invoice:inv-sub-1:attempt:3");
    expect(charged[0].attempt).toBe(3);
    expect(action.status).toBe("failed");
    expect(store.calls).toContainEqual(["bumpRenewalAttempts", "sub-1"]);
    expect(store.calls.some((call) => call[0] === "markPastDue")).toBe(false);
    // The calendar was in the day-0 letter; a failed retry sends nothing (ADR-319).
    expect(notify.calls).toHaveLength(0);
  });

  it("does not charge a retry whose invoice vanished", async () => {
    const store = fakeStore({ subscriptions: [pastDue()], invoice: null, attempts: 1 });
    const charge = vi.fn();
    const loops = createBillingLoops({ store, log: silent, now: () => NOW + 3 * DAY, charge });

    const [action] = (await loops.tick()).actions;

    expect(action.status).toBe("skipped");
    expect(charge).not.toHaveBeenCalled();
    expect(store.calls.some((call) => call[0] === "bumpRenewalAttempts")).toBe(false);
  });

  it("suspends after fourteen days and freezes the rooms beyond the Free plan", async () => {
    const store = fakeStore({ subscriptions: [pastDue()], attempts: 4 });
    const notify = recorder();
    const charge = vi.fn();
    const loops = createBillingLoops({
      store,
      notify,
      log: silent,
      now: () => NOW + 14 * DAY,
      charge,
    });

    const [action] = (await loops.tick()).actions;

    expect(action.action).toBe("suspend");
    expect(charge).not.toHaveBeenCalled();
    expect(store.calls).toContainEqual(["suspendSubscription", "sub-1"]);
    expect(store.calls).toContainEqual([
      "reconcileFrozenRooms",
      "org-1",
      PLANS.free.rooms,
    ]);
    expect(notify.calls.map((call) => call[0])).toEqual(["subscription_suspended"]);
  });

  it("cancels at period end without a charge", async () => {
    const store = fakeStore({
      subscriptions: [active({ cancel_at_period_end: true })],
    });
    const notify = recorder();
    const charge = vi.fn();
    const loops = createBillingLoops({ store, notify, log: silent, now: loopClock, charge });

    const [action] = (await loops.tick()).actions;

    expect(action.action).toBe("cancel");
    expect(charge).not.toHaveBeenCalled();
    expect(store.calls).toContainEqual(["cancelSubscription", "sub-1"]);
    expect(notify.calls.map((call) => call[0])).toEqual(["subscription_canceled"]);
  });

  it("only records the invoice when no charge is injected", async () => {
    const store = fakeStore({ subscriptions: [active()] });
    const loops = createBillingLoops({ store, log: silent, now: loopClock });

    const [action] = (await loops.tick()).actions;

    expect(action).toEqual({ id: "sub-1", action: "invoice", status: "unattempted" });
    expect(store.calls.filter((call) => call[0] === "renewalInvoice")).toHaveLength(1);
    expect(store.calls.some((call) => call[0] === "advanceSubscription")).toBe(false);
  });

  it("is idempotent across two ticks", async () => {
    const store = fakeStore({ subscriptions: [active()] });
    const charge = vi.fn(async () => ({ status: "succeeded" }));
    const loops = createBillingLoops({ store, log: silent, now: loopClock, charge });

    const first = await loops.tick();
    const second = await loops.tick();

    expect(first.processed).toBe(1);
    expect(second.processed).toBe(0);
    expect(charge).toHaveBeenCalledTimes(1);
    expect(store.calls.filter((call) => call[0] === "renewalInvoice")).toHaveLength(1);
  });

  it("keeps the batch going when one subscription throws", async () => {
    const broken = active({ id: "sub-broken" });
    const healthy = active({ id: "sub-healthy" });
    const store = fakeStore({ subscriptions: [broken, healthy] });
    const charge = vi.fn(async ({ subscription }) => {
      if (subscription.id === "sub-broken") throw Object.assign(new Error("boom"), { code: "X" });
      return { status: "succeeded" };
    });
    const loops = createBillingLoops({ store, log: silent, now: loopClock, charge });

    const result = await loops.tick();

    expect(result.processed).toBe(2);
    expect(store.calls).toContainEqual(["markPastDue", "sub-broken"]);
    expect(store.calls).toContainEqual([
      "advanceSubscription",
      { id: "sub-healthy", periodEnd: invoiceFor(healthy).period_end },
    ]);
  });

  it("survives a failing mail without undoing a stored payment", async () => {
    const store = fakeStore({ subscriptions: [active()] });
    const notify = async () => {
      throw new Error("mail is down");
    };
    const loops = createBillingLoops({
      store,
      notify,
      log: silent,
      now: loopClock,
      charge: async () => ({ status: "succeeded" }),
    });

    const [action] = (await loops.tick()).actions;

    expect(action.status).toBe("succeeded");
    expect(store.calls.some((call) => call[0] === "advanceSubscription")).toBe(true);
  });

  it("starts and stops one interval", async () => {
    vi.useFakeTimers();
    try {
      const store = fakeStore({ subscriptions: [] });
      const loops = createBillingLoops({ store, log: silent, now: loopClock, intervalMs: 1000 });

      loops.start();
      loops.start();
      await vi.advanceTimersByTimeAsync(1000);
      expect(store.calls.filter((call) => call[0] === "dueSubscriptions")).toHaveLength(1);

      loops.stop();
      await vi.advanceTimersByTimeAsync(3000);
      expect(store.calls.filter((call) => call[0] === "dueSubscriptions")).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * Days 0–15 of one unpaid renewal, tick by tick (ADR-319): which charge runs, which letter
 * leaves, and when the plan ends. Every day is ticked twice, as the ten-minute loop would.
 */
describe("fourteen days of grace, day by day (ADR-319)", () => {
  function dayStore() {
    const subscription = active();
    const invoice = invoiceFor(subscription);
    const row = { ...subscription };
    let attempts = 0;
    return {
      row,
      async dueSubscriptions() {
        return row.status === "active" || row.status === "past_due" ? [{ ...row }] : [];
      },
      async renewalInvoice() { return invoice; },
      async openInvoiceFor() { return invoice; },
      async advanceSubscription({ periodEnd }) {
        row.status = "active";
        row.current_period_end = periodEnd;
        row.past_due_since = null;
        attempts = 0;
      },
      async markPastDue() { row.status = "past_due"; row.past_due_since = new Date(NOW); },
      async bumpRenewalAttempts() { attempts += 1; return attempts; },
      async renewalAttempts() { return attempts; },
      async suspendSubscription() { row.status = "suspended"; },
      async cancelSubscription() {},
      async reconcileFrozenRooms() { return 0; },
      async withTenant(_orgId, fn) { return fn(); },
    };
  }

  const EXPECTED = {
    0: { charges: [1], letters: ["payment_failed"] },
    1: { charges: [2], letters: [] },
    3: { charges: [3], letters: [] },
    7: { charges: [4], letters: [] },
    12: { charges: [], letters: ["payment_final_attempt", "payment_final_attempt"] },
    13: { charges: [5], letters: [] },
    14: { charges: [], letters: ["subscription_suspended"] },
  };

  it("charges on days 0, 1, 3, 7 and 13, writes on 0, 12 and 14, and stops on 15", async () => {
    const store = dayStore();
    const notify = recorder();
    let day = 0;
    const charges = [];
    const loops = createBillingLoops({
      store,
      notify,
      log: silent,
      now: () => NOW + day * DAY,
      charge: async ({ attempt }) => {
        charges.push([day, attempt]);
        return { status: "failed", failureCode: "card_declined" };
      },
    });

    for (day = 0; day <= 15; day += 1) {
      const before = { charges: charges.length, letters: notify.calls.length };
      await loops.tick();
      await loops.tick();
      const today = {
        charges: charges.slice(before.charges).map(([, attempt]) => attempt),
        letters: notify.calls.slice(before.letters).map(([type]) => type),
      };
      expect(today, `day ${day}`).toEqual(EXPECTED[day] ?? { charges: [], letters: [] });
    }
    expect(store.row.status).toBe("suspended");
  });

  it("passes the calendar and a deduplication key with every letter", async () => {
    const store = dayStore();
    const notify = recorder();
    let day = 0;
    const loops = createBillingLoops({
      store, notify, log: silent, now: () => NOW + day * DAY,
      charge: async () => ({ status: "failed", failureCode: "card_declined" }),
    });
    for (day = 0; day <= 14; day += 1) await loops.tick();

    const [failed, final, suspended] = notify.calls.map(([, payload]) => payload);
    expect(failed.schedule).toEqual(renewalSchedule(at(0)));
    expect(failed.dedupeKey).toBe("inv-sub-1");
    expect(final.schedule.finalAttempt).toEqual(at(13));
    expect(final.dedupeKey).toBe("inv-sub-1:final");
    expect(suspended.dedupeKey).toBe(`sub-1:${NOW}`);
  });

  it("returns to active and announces the renewal when a retry succeeds", async () => {
    const store = dayStore();
    const notify = recorder();
    let day = 0;
    const loops = createBillingLoops({
      store, notify, log: silent, now: () => NOW + day * DAY,
      charge: async () => (day === 7 ? { status: "succeeded" } : { status: "failed" }),
    });
    for (day = 0; day <= 15; day += 1) await loops.tick();

    expect(store.row.status).toBe("active");
    expect(notify.calls.map(([type]) => type)).toEqual(["payment_failed", "payment_succeeded"]);
  });
});

describe("the saved method envelope (§4)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("unseals only the envelope built for the same row", () => {
    const kek = { key: randomBytes(32), id: "test-kek" };
    const id = "method-1";
    const sealed = encryptSecret(JSON.stringify({ methodRef: "pm_secret" }), {
      scope: "payment_method",
      scopeId: id,
      provider: "payment",
      id,
      kek,
    });
    const method = {
      id,
      sealed: {
        scope: "payment_method",
        scope_id: id,
        provider: "payment",
        id,
        ciphertext: sealed.ciphertext,
        nonce: sealed.nonce,
        dek_wrapped: sealed.dekWrapped,
        dek_nonce: sealed.dekNonce,
        kek_id: sealed.kekId,
      },
    };

    expect(openPaymentMethodRef(method, { kek })).toBe("pm_secret");
    // The envelope is bound to its own row: moving it to another scope id must not open.
    expect(() =>
      openPaymentMethodRef(
        { ...method, sealed: { ...method.sealed, scope_id: "method-2" } },
        { kek },
      ),
    ).toThrow("the saved payment method could not be unsealed");
  });
});
