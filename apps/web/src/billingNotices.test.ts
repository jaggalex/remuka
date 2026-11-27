import { describe, expect, it } from "vitest";
import { trialDaysLeft, trialKey } from "./BillingStatusBanner";
import { cancelledNotice } from "./useBillingChange";
import { enBilling } from "./i18n/en-billing";
import { ruBilling } from "./i18n/ru-billing";

const STRINGS = { ru: ruBilling, en: enBilling };

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-27T10:00:00Z");

function tr(lang: "ru" | "en") {
  return (key: string, values: Record<string, string | number> = {}) =>
    String((STRINGS as Record<string, Record<string, string>>)[lang]?.[key]).replace(/\{(\w+)\}/g, (_, name: string) => String(values[name]));
}

describe("the trial counter (ADR-319)", () => {
  it("counts a started day as a day and stops at zero", () => {
    expect(trialDaysLeft(new Date(NOW + 3 * DAY).toISOString(), NOW)).toBe(3);
    expect(trialDaysLeft(new Date(NOW + 2.2 * DAY).toISOString(), NOW)).toBe(3);
    expect(trialDaysLeft(new Date(NOW - DAY).toISOString(), NOW)).toBe(0);
    expect(trialDaysLeft(null, NOW)).toBeNull();
  });

  it("agrees the Russian word with the number", () => {
    expect(tr("ru")(trialKey("ru", 1), { n: 1 })).toMatch(/^Пробный период: остался 1 день\./);
    expect(tr("ru")(trialKey("ru", 3), { n: 3 })).toMatch(/^Пробный период: осталось 3 дня\./);
    expect(tr("ru")(trialKey("ru", 5), { n: 5 })).toMatch(/^Пробный период: осталось 5 дней\./);
    expect(tr("en")(trialKey("en", 1), { n: 1 })).toMatch(/^Trial: 1 day left\./);
  });
});

describe("the cancelled downgrade notice (ADR-319)", () => {
  const current = {
    id: "s", plan: "team", status: "active" as const, interval: "month" as const, amount: 59000, currency: "RUB",
    currentPeriodStart: "2026-11-24T00:00:00Z", currentPeriodEnd: "2026-12-24T00:00:00Z", cancelAtPeriodEnd: false, trialEnd: null,
  };

  it("names the plan that carries on and the next charge", () => {
    expect(cancelledNotice(tr("ru") as never, current, "ru")).toMatch(/^Изменение отменено\. Team продолжится, 24 декабря( 2026 г\.)? спишем 590/);
  });

  it("drops the charge when auto-renewal is off", () => {
    expect(cancelledNotice(tr("ru") as never, { ...current, cancelAtPeriodEnd: true }, "ru")).toBe("Изменение отменено. Team продолжится");
  });
});
