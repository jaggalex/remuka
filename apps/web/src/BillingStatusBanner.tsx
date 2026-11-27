import { Banner } from "@remo/ui";
import { useEffect, useState } from "react";
import { billingApi, type OrgBilling } from "./apiBilling";
import { pluralForm, useI18n, type TranslationKey } from "./i18n";

const PLAN_KEY: Record<string, TranslationKey> = {
  free: "billing.plan.free",
  pro: "billing.plan.pro",
  team: "billing.plan.team",
  business: "billing.plan.business",
  unlimited: "billing.plan.unlimited",
};

const TRIAL_KEYS: [TranslationKey, TranslationKey, TranslationKey] = [
  "billing.trialLeft.one",
  "billing.trialLeft.few",
  "billing.trialLeft.many",
];

/** «24 декабря», with the year only when it is not this one — as the letters write it. */
export function formatDay(value: string, lang: "ru" | "en", now = new Date()): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString(lang === "ru" ? "ru-RU" : "en-GB", {
    day: "numeric", month: "long", ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** Whole days left in a trial, counting a started day as a day; `null` without a trial. */
export function trialDaysLeft(trialEnd: string | null | undefined, now = Date.now()): number | null {
  if (!trialEnd) return null;
  const left = Date.parse(trialEnd) - now;
  if (!Number.isFinite(left)) return null;
  return Math.max(0, Math.ceil(left / 86_400_000));
}

export function trialKey(lang: "ru" | "en", n: number): TranslationKey {
  return TRIAL_KEYS[pluralForm(lang, n)];
}

/**
 * Two states of the plan that a person must see on every page of the space (ADR-319,
 * `spec/billing.md` §8.5): an admin whose renewal failed learns the day the space moves to
 * Free, with one action; a member of a suspended space learns why rooms are read-only and
 * who can change it. During the grace members see nothing: nothing has changed for them.
 *
 * A server without billing answers `404`, and the banner then simply is not there.
 */
export function BillingStatusBanner({ orgId, onOpenBilling }: { orgId: string | null; onOpenBilling: () => void }) {
  const { t, lang } = useI18n();
  const [billing, setBilling] = useState<OrgBilling | null>(null);

  useEffect(() => {
    setBilling(null);
    if (!orgId) return;
    let alive = true;
    billingApi.org(orgId).then((summary) => { if (alive) setBilling(summary); }).catch(() => {});
    return () => { alive = false; };
  }, [orgId]);

  if (!billing) return null;
  const plan = t(PLAN_KEY[billing.subscription?.plan ?? billing.plan] ?? "billing.plan.free");
  if (billing.viewerIsAdmin && billing.status === "past_due" && billing.graceEnd) {
    return (
      <Banner tone="warning" action={{ label: t("billing.banner.updateCard"), onClick: onOpenBilling }}>
        {t("billing.banner.pastDue", { plan, date: formatDay(billing.graceEnd, lang) })}
      </Banner>
    );
  }
  if (!billing.viewerIsAdmin && billing.status === "suspended") {
    return <Banner tone="info">{t("billing.banner.memberFree")}</Banner>;
  }
  return null;
}
