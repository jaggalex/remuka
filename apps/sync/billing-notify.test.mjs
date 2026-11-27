import { describe, expect, it } from "vitest";
import { createBillingNotify, letterId } from "./billing-notify.mjs";
import { renewalSchedule } from "./billing-renewals.mjs";
import { render } from "./mail-templates.mjs";
import { formatMailDate, formatMailMoney } from "./billing-format.mjs";

const MAIL = { driver: "console", appOrigin: "https://app.example" };

function storeDouble({ lang = null } = {}) {
  const sent = [];
  return {
    sent,
    withTenant: (_org, fn) => fn(),
    billingAccount: async () => ({ billing_email: "anya@romashka.team" }),
    mailLangByEmail: async () => lang,
    billingLetterFacts: async () => ({ name: "Ромашка", kind: "shared", rooms: 12, last4: "4242" }),
    enqueueMail: async (row) => { sent.push(row); return row; },
  };
}

describe("billing letters speak the payer's language (ADR-319 §5)", () => {
  it("formats money from minor units with the currency symbol, not the ISO code", () => {
    expect(formatMailMoney(59000, "RUB", "ru")).toBe("590\u00a0₽");
    expect(formatMailMoney(590000, "RUB", "ru")).toBe("5\u00a0900\u00a0₽");
    expect(formatMailMoney(59000, "RUB", "en")).toBe("590\u00a0₽");
    expect(formatMailMoney(1999, "USD", "en")).toBe("$19.99");
    expect(formatMailMoney(14500, "RUB", "ru")).toBe("145\u00a0₽");
  });

  it("writes dates as words in the letter's language", () => {
    const now = new Date("2026-11-27T10:00:00Z");
    expect(formatMailDate("2026-12-24T00:00:00Z", "ru", now)).toBe("24 декабря");
    expect(formatMailDate("2026-12-24T00:00:00Z", "en", now)).toBe("24 December");
    expect(formatMailDate("2027-01-03T00:00:00Z", "ru", now)).toBe("3 января 2027 г.");
  });

  it("sends in the recipient's language, with a formatted amount and the scheduled retry date", async () => {
    const store = storeDouble({ lang: "en" });
    const notify = createBillingNotify({ store, mailConfig: MAIL, kek: "unused", now: () => new Date("2026-12-27T09:00:00Z") });
    await notify("payment_failed", {
      orgId: "org-1",
      invoice: { total: 59000, currency: "RUB", period_end: "2027-01-27T00:00:00Z" },
      retryAt: new Date("2026-12-30T09:00:00Z"),
    });
    expect(store.sent).toHaveLength(1);
    expect(store.sent[0]).toMatchObject({ locale: "en", template: "payment_failed" });
    expect(store.sent[0].params.amount).toBe("590\u00a0₽");
    expect(store.sent[0].params.retryAt).toBe("30 December");
  });

  it("uses users.lang, and English when the payer has none (spec/mail.md §5.5)", async () => {
    const ru = storeDouble({ lang: "ru" });
    await createBillingNotify({ store: ru, mailConfig: MAIL, kek: "unused", now: () => new Date("2026-11-27T09:00:00Z") })(
      "payment_succeeded",
      { orgId: "org-1", invoice: { total: 29000, currency: "RUB", period_end: "2026-12-27T00:00:00Z" } },
    );
    expect(ru.sent[0]).toMatchObject({ locale: "ru", params: { amount: "290\u00a0₽", period: "27 декабря" } });
    const none = storeDouble();
    await createBillingNotify({ store: none, mailConfig: MAIL, kek: "unused" })("payment_succeeded", {
      orgId: "org-1", invoice: { total: 29000, currency: "RUB", period_end: "2026-12-27T00:00:00Z" },
    });
    expect(none.sent[0].locale).toBe("en");
  });
});

describe("the grace letters carry the renewal calendar (ADR-319)", () => {
  const DAY = 86_400_000;
  const since = new Date("2026-12-27T09:00:00Z");
  const invoice = {
    id: "inv-1", number: "RU-2026-000123", total: 59000, currency: "RUB",
    lines: [{ kind: "subscription", plan: "team" }],
    period_start: "2026-12-27T00:00:00Z", period_end: "2027-01-27T00:00:00Z",
  };

  it("writes payment_failed with the grace end, the remaining retries and the card", async () => {
    const store = storeDouble({ lang: "ru" });
    const notify = createBillingNotify({ store, mailConfig: MAIL, kek: "unused", now: () => since });
    await notify("payment_failed", {
      orgId: "org-1", invoice, failureCode: "card_declined", schedule: renewalSchedule(since), dedupeKey: "inv-1",
    });
    const [row] = store.sent;
    expect(row.id).toBe(letterId("payment_failed", "inv-1"));
    const mail = render(row.template, row.locale, row.params);
    expect(mail.subject).toBe("Оплата за Team не прошла — обновите карту до 10 января 2027 г.");
    expect(mail.text).toContain("Банк отклонил карту •••• 4242, и мы не смогли списать 590\u00a0₽ за продление Team.");
    expect(mail.text).toContain("Повторим попытку 28 декабря, 30 декабря, 3 января 2027 г. и 9 января 2027 г.");
    expect(mail.text).toContain("активными останутся 5 комнат");
  });

  it("writes the final attempt for tomorrow and the suspension with the room counts", async () => {
    const store = storeDouble({ lang: "en" });
    let now = new Date(since.getTime() + 12 * DAY);
    const notify = createBillingNotify({ store, mailConfig: MAIL, kek: "unused", now: () => now });
    await notify("payment_final_attempt", { orgId: "org-1", invoice, schedule: renewalSchedule(since) });
    now = new Date(since.getTime() + 14 * DAY);
    await notify("subscription_suspended", { orgId: "org-1", subscription: { plan: "team" } });
    const [final, suspended] = store.sent.map((row) => render(row.template, row.locale, row.params));
    expect(final.text).toContain("On 9 January we'll try once more to charge 590\u00a0₽ to card •••• 4242.");
    expect(final.text).toContain("5 of 12 rooms stay active");
    expect(suspended.subject).toBe("“Ромашка” has moved to Free");
    expect(suspended.text).toContain("from 10 January “Ромашка” is on Free");
  });

  it("names a personal space «Личное» and derives one id per operation", async () => {
    const store = storeDouble({ lang: "ru" });
    store.billingLetterFacts = async () => ({ name: "anna", kind: "personal", rooms: 3, last4: null });
    const notify = createBillingNotify({ store, mailConfig: MAIL, kek: "unused", now: () => since });
    await notify("payment_failed", { orgId: "org-1", invoice, schedule: renewalSchedule(since), dedupeKey: "inv-1" });
    expect(store.sent[0].params.space).toBe("Личное");
    expect(store.sent[0].params.reason).toBe("Платёж не прошёл");
    expect(letterId("payment_failed", "inv-1")).toBe(letterId("payment_failed", "inv-1"));
    expect(letterId("payment_failed", "inv-1")).not.toBe(letterId("payment_succeeded", "inv-1"));
    expect(letterId("payment_failed", "inv-1")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
