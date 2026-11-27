/**
 * Letters after a plan decision and on the calendar (ADR-319, `spec/billing.md` §7).
 *
 * The store is a double: what is pinned here is which event or date becomes which letter,
 * who receives it and under which deduplication key, and that the values are written in
 * the letter's language.
 */
import { describe, expect, it } from "vitest";
import { cardExpiresAt, createBillingLetters, downgradeNotes } from "./billing-letters.mjs";
import { createBillingNotify, letterId } from "./billing-notify.mjs";
import { render } from "./mail-templates.mjs";

const NOW = new Date("2026-11-27T10:00:00Z");
const DAY = 86_400_000;
const MAIL = { driver: "console", appOrigin: "https://app.example" };

function store({ events = [], reminders = {}, lang = "ru" } = {}) {
  const sent = new Map();
  return {
    sent,
    withTenant: (_org, fn) => fn(),
    billingAccount: async () => ({ billing_email: "pay@romashka.team" }),
    mailLangByEmail: async () => lang,
    billingLetterFacts: async () => ({ name: "Ромашка", kind: "shared", rooms: 12, frozen: 4, last4: "4242" }),
    seatUsage: async () => 4,
    orgAdminEmails: async () => ["anya@romashka.team", "ilya@romashka.team"],
    billingLetterEvents: async () => events,
    billingReminders: async () => ({ trials: [], renewals: [], cards: [], ...reminders }),
    // The real insert ignores a repeated id; the double does the same.
    enqueueMail: async (row) => { if (!sent.has(row.id)) sent.set(row.id, row); },
  };
}

function loop(s, now = NOW) {
  const notify = createBillingNotify({ store: s, mailConfig: MAIL, kek: "unused", now: () => now });
  return createBillingLetters({ store: s, notify, now: () => now, log: { error() {} } });
}

const rendered = (s) => [...s.sent.values()].map((row) => ({ to: row.toEmail, ...render(row.template, row.locale, row.params), template: row.template }));

const subscription = { id: "sub-1", plan: "team", amount: 29000, currency: "RUB", interval: "month", current_period_end: "2026-12-27T00:00:00Z" };

describe("plan decisions become letters to every admin", () => {
  it("announces a scheduled downgrade once per admin, however many ticks", async () => {
    const event = {
      id: "ev-1", orgId: "org-1", type: "subscription.change_scheduled", occurredAt: NOW, subscription,
      data: { from: null, to: { plan: "pro", fromPlan: "team", amount: 29000, currency: "RUB", interval: "month", effectiveAt: "2026-12-27T00:00:00Z" } },
    };
    const s = store({ events: [event] });
    const letters = loop(s);
    await letters.tick();
    await letters.tick();
    const mail = rendered(s);
    expect(mail.map((m) => m.to)).toEqual(["anya@romashka.team", "ilya@romashka.team"]);
    expect(mail[0].subject).toBe("С 27 декабря в «Ромашка» — Pro");
    expect(mail[0].text.startsWith(
      "До 27 декабря действует Team. Pro начнёт действовать после оплаты продления — 290 ₽ в месяц. Мест станет 5 вместо 20. Выбрать активные комнаты или отменить изменение можно до 27 декабря: https://app.example/",
    )).toBe(true);
    expect([...s.sent.keys()][0]).toBe(letterId("downgrade_scheduled", "ev-1:anya@romashka.team"));
  });

  it("ignores a cancelled schedule and an upgrade", async () => {
    const s = store({ events: [
      { id: "ev-2", orgId: "org-1", type: "subscription.change_scheduled", subscription, data: { from: { plan: "pro" }, to: null } },
      { id: "ev-3", orgId: "org-1", type: "subscription.change_applied", subscription, data: { from: "pro", to: "team" } },
    ] });
    await loop(s).tick();
    expect(s.sent.size).toBe(0);
  });

  it("writes downgrade_applied with the charge, the seats and the read-only rooms", async () => {
    const s = store({ events: [{
      id: "ev-4", orgId: "org-1", type: "subscription.change_applied", occurredAt: NOW,
      subscription: { ...subscription, plan: "pro" },
      data: { from: "team", to: "pro", periodStart: "2026-12-27T00:00:00Z" },
    }] });
    await loop(s).tick();
    const [mail] = rendered(s);
    expect(mail.subject).toBe("«Ромашка» перешла на Pro");
    expect(mail.text.startsWith(
      "С 27 декабря в «Ромашка» действует Pro — списали 290 ₽ за месяц. Места: 4 из 5. Активные комнаты: 8; остальные 4 — только для чтения, экспорт работает.",
    )).toBe(true);
  });

  it("writes downgrade_applied to Free without a charge", async () => {
    const s = store({ lang: "en", events: [{
      id: "ev-5", orgId: "org-1", type: "subscription.change_applied", occurredAt: NOW, subscription,
      data: { from: "team", to: "free" },
    }] });
    await loop(s).tick();
    const [mail] = rendered(s);
    expect(mail.text.startsWith("From 27 November, “Ромашка” is on Free. Seats: 4 of 5.")).toBe(true);
  });

  it("tells every admin that auto-renewal is off, with the access date", async () => {
    const s = store({ events: [{
      id: "ev-6", orgId: "org-1", type: "subscription.canceled_at_period_end", occurredAt: NOW, subscription,
      data: { currentPeriodEnd: "2026-12-27T00:00:00Z" },
    }] });
    await loop(s).tick();
    const mail = rendered(s);
    expect(mail).toHaveLength(2);
    expect(mail[0].subject).toBe("Автопродление Team выключено");
    expect(mail[0].text).toContain("Доступ к Team в «Ромашка» — до 27 декабря, потом пространство перейдёт на Бесплатный.");
  });
});

describe("calendar reminders", () => {
  it("reminds admins of a trial that ends in three days", async () => {
    const s = store({ reminders: { trials: [{ id: "sub-t", org_id: "org-1", plan: "team", trial_end: new Date(NOW.getTime() + 3 * DAY) }] } });
    const letters = loop(s);
    await letters.tick();
    await letters.tick();
    const mail = rendered(s);
    expect(mail).toHaveLength(2);
    expect(mail[0].template).toBe("trial_ending");
    expect(mail[0].subject).toContain("30 ноября");
  });

  it("reminds the payer of a yearly renewal with its sum", async () => {
    const s = store({ reminders: { renewals: [{ id: "sub-y", org_id: "org-1", plan: "team", amount: 590000, currency: "RUB", current_period_end: new Date(NOW.getTime() + 7 * DAY) }] } });
    await loop(s).tick();
    const [mail] = rendered(s);
    expect(mail.to).toBe("pay@romashka.team");
    expect(mail.template).toBe("renewal_upcoming");
    expect(mail.text).toContain("5 900 ₽");
    expect(mail.text).toContain("4 декабря");
  });

  it("warns about a card thirty days and seven days before it expires, once each", async () => {
    const card = { id: "pm-1", org_id: "org-1", last4: "4242", exp_month: 12, exp_year: 2026 };
    expect(cardExpiresAt(12, 2026)).toEqual(new Date("2027-01-01T00:00:00Z"));
    const s = store({ reminders: { cards: [card] } });
    // 35 days before: nothing; 30 days: the first letter; 20: nothing new; 7: the second.
    for (const left of [35, 30, 20, 7, 6]) await loop(s, new Date(Date.UTC(2027, 0, 1) - left * DAY)).tick();
    const mail = rendered(s);
    expect(mail.map((m) => m.template)).toEqual(["payment_method_expiring", "payment_method_expiring"]);
    expect(mail[0].text).toContain("•••• 4242");
    expect(mail[0].text).toContain("12/2026");
  });
});

describe("downgrade notes", () => {
  it("says there will be no more charges for Free, in both languages", () => {
    expect(downgradeNotes({ to: "free", from: "pro", amount: 0, currency: "RUB" }, "ru").planNote).toBe("Списаний больше не будет.");
    expect(downgradeNotes({ to: "free", from: "pro", amount: 0, currency: "RUB" }, "en").planNote).toBe("There will be no more charges.");
    expect(downgradeNotes({ to: "free", from: "pro", amount: 0, currency: "RUB" }, "ru").impact)
      .toBe("Активными останутся 5 комнат, остальные станут только для чтения.");
  });
});
