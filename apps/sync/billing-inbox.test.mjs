/**
 * The unit half of the inbound journal (`spec/payment-providers.md` §5): which payment an
 * event names, what "forward only" means, and the retry ladder. The database test proves
 * the consequences; this file proves the decisions without a store.
 */
import { describe, expect, it, vi } from "vitest";
import {
  INBOX_MAX_ATTEMPTS,
  applyPaymentEvent,
  createBillingInbox,
  paymentTransition,
  resolvePayment,
} from "./billing-inbox.mjs";

const silent = { error() {}, warn() {}, log() {} };

const CHAIN = {
  payment_id: "pay-1",
  org_id: "org-1",
  invoice_id: "inv-1",
  connection_id: "conn-1",
  payment_status: "pending",
  invoice_status: "open",
  payment_amount: 29000,
  payment_currency: "RUB",
  invoice_currency: "RUB",
  lines: [{ kind: "subscription" }],
  period_end: "2026-12-01T00:00:00.000Z",
};

function event({ status = "succeeded", paymentId = "pay-1", providerId = "prov-1" } = {}) {
  return {
    type: "payment.updated",
    paymentId,
    payment: {
      providerPaymentId: providerId,
      status,
      amount: status === "canceled" ? 0 : 29000,
      currency: "RUB",
    },
  };
}

describe("payment selection (§5)", () => {
  it("prefers our payment id in the metadata", async () => {
    const store = {
      paymentChainFor: vi.fn(async (id) => (id === "pay-1" ? CHAIN : null)),
      paymentChainByProviderId: vi.fn(async () => null),
    };
    const chain = await resolvePayment({
      store,
      connectionId: "conn-1",
      event: event({ paymentId: "pay-1", providerId: "prov-1" }),
    });
    expect(chain).toBe(CHAIN);
    expect(store.paymentChainFor).toHaveBeenCalledWith("pay-1");
    expect(store.paymentChainByProviderId).not.toHaveBeenCalled();
  });

  it("falls back to the provider id in the same connection", async () => {
    const byProvider = { ...CHAIN, payment_id: "pay-2" };
    const store = {
      paymentChainFor: vi.fn(async () => null),
      paymentChainByProviderId: vi.fn(async ({ connectionId, providerPaymentId }) => {
        expect(connectionId).toBe("conn-1");
        expect(providerPaymentId).toBe("prov-9");
        return byProvider;
      }),
    };
    const chain = await resolvePayment({
      store,
      connectionId: "conn-1",
      event: event({ paymentId: "", providerId: "prov-9" }),
    });
    expect(chain).toBe(byProvider);
  });

  it("does not settle a payment id that belongs to another connection", async () => {
    const store = {
      paymentChainFor: vi.fn(async () => ({ ...CHAIN, connection_id: "conn-other" })),
      paymentChainByProviderId: vi.fn(async () => null),
    };
    const chain = await resolvePayment({
      store,
      connectionId: "conn-1",
      event: event({ paymentId: "pay-1" }),
    });
    expect(chain).toBeNull();
    expect(store.paymentChainByProviderId).toHaveBeenCalledWith({
      connectionId: "conn-1",
      providerPaymentId: "prov-1",
    });
  });
});

describe("only forward (§5)", () => {
  it.each([
    ["pending", "succeeded", "apply"],
    ["pending", "canceled", "apply"],
    ["succeeded", "succeeded", "repeat"],
    ["canceled", "canceled", "repeat"],
    ["succeeded", "canceled", "stale"],
    ["canceled", "succeeded", "stale"],
    ["failed", "succeeded", "stale"],
    ["pending", "pending", "ignore"],
    ["pending", "failed", "ignore"],
  ])("%s → %s is %s", (current, next, expected) => {
    expect(paymentTransition(current, next)).toBe(expected);
  });

  it("applies a cancellation to a pending payment only", async () => {
    const store = {
      paymentChainFor: async () => ({ ...CHAIN, payment_status: "pending" }),
      cancelPayment: vi.fn(async ({ paymentId }) => ({ id: paymentId, status: "canceled" })),
    };
    const outcome = await applyPaymentEvent({
      store,
      connectionId: "conn-1",
      event: event({ status: "canceled", providerId: null }),
      log: silent,
    });
    expect(outcome).toMatchObject({ applied: true, orgId: "org-1" });
    expect(store.cancelPayment).toHaveBeenCalledWith({ paymentId: "pay-1", failureCode: null });
  });

  it("leaves a paid payment alone when an older cancellation arrives", async () => {
    const store = {
      paymentChainFor: async () => ({
        ...CHAIN,
        payment_status: "succeeded",
        invoice_status: "paid",
      }),
      cancelPayment: vi.fn(),
    };
    const outcome = await applyPaymentEvent({
      store,
      connectionId: "conn-1",
      event: event({ status: "canceled" }),
      log: silent,
    });
    expect(outcome).toMatchObject({ applied: false, reason: "STALE" });
    expect(store.cancelPayment).not.toHaveBeenCalled();
  });

  it("treats the same status again as a no-op", async () => {
    const store = {
      paymentChainFor: async () => ({
        ...CHAIN,
        payment_status: "succeeded",
        invoice_status: "paid",
      }),
    };
    const outcome = await applyPaymentEvent({
      store,
      connectionId: "conn-1",
      event: event({ status: "succeeded" }),
      log: silent,
    });
    expect(outcome).toMatchObject({ applied: false, reason: "ALREADY_APPLIED" });
  });

  it("refuses a provider sum that is not the invoice total", async () => {
    const store = {
      paymentChainFor: async () => ({ ...CHAIN }),
      billingInvoiceGlobal: async () => ({
        id: "inv-1",
        org_id: "org-1",
        status: "open",
        total: 29000,
        currency: "RUB",
        lines: [{ kind: "subscription" }],
      }),
    };
    await expect(
      applyPaymentEvent({
        store,
        connectionId: "conn-1",
        event: {
          ...event(),
          payment: { ...event().payment, amount: 100 },
        },
        log: silent,
      }),
    ).rejects.toMatchObject({ code: "AMOUNT_MISMATCH" });
  });
});

describe("the retry ladder (§5)", () => {
  function failingStore() {
    const row = { attempts: 0 };
    const store = {
      claimProviderEventBatch: async () => [
        {
          ...row,
          id: "ev-fail",
          org_id: null,
          connection_id: "conn-1",
          payload: {
            type: "payment.updated",
            paymentId: "missing",
            payment: { providerPaymentId: "missing", status: "succeeded", amount: 1 },
          },
        },
      ],
      markProviderEventRetry: vi.fn(async ({ attempts, error }) => {
        row.attempts = attempts;
        row.error = error;
      }),
      markProviderEventDead: vi.fn(async ({ attempts, error }) => {
        row.attempts = attempts;
        row.dead = error;
      }),
      markProviderEventProcessed: vi.fn(),
      paymentChainFor: async () => null,
    };
    return { store, row };
  }

  it("retries and finally buries the event after eight attempts", async () => {
    const { store, row } = failingStore();
    const inbox = createBillingInbox({ store, log: silent, now: () => 0 });
    for (let pass = 0; pass < INBOX_MAX_ATTEMPTS; pass += 1) await inbox.drain();

    expect(store.markProviderEventRetry).toHaveBeenCalledTimes(INBOX_MAX_ATTEMPTS - 1);
    expect(store.markProviderEventDead).toHaveBeenCalledTimes(1);
    expect(row).toMatchObject({ attempts: INBOX_MAX_ATTEMPTS, dead: "PAYMENT_NOT_FOUND" });
    expect(store.markProviderEventProcessed).not.toHaveBeenCalled();
  });

  it("records an ignored event without counting it", async () => {
    const store = {
      claimProviderEventBatch: async () => [
        { id: "ev-1", attempts: 0, org_id: null, connection_id: "conn-1", payload: {} },
      ],
      markProviderEventProcessed: vi.fn(async () => {}),
    };
    const metrics = { inc: vi.fn() };
    const inbox = createBillingInbox({ store, log: silent, metrics });
    await inbox.drain();
    expect(store.markProviderEventProcessed).toHaveBeenCalledWith({
      id: "ev-1",
      orgId: null,
      reason: "IGNORED",
    });
    expect(metrics.inc).not.toHaveBeenCalled();
  });
});
