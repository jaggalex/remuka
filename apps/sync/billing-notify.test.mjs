import { describe, expect, it } from "vitest";
import { createBillingNotify } from "./billing-notify.mjs";
import { formatMailDate, formatMailMoney } from "./billing-format.mjs";

const MAIL = { driver: "console", appOrigin: "https://app.example" };

function storeDouble({ lang = null } = {}) {
  const sent = [];
  return {
    sent,
    withTenant: (_org, fn) => fn(),
    billingAccount: async () => ({ billing_email: "anya@romashka.team" }),
    mailLangByEmail: async () => lang,
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
