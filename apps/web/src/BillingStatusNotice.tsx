import { useEffect, useRef, useState } from "react";
import { billingApi, type OrgBilling } from "./apiBilling";
import { useNotices } from "./notices";
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

/**
 * «24 декабря», with the year only when it is not this one — as the letters write it. The
 * day is read in UTC, like the letters (`billing-format.mjs`): a period that ends at UTC
 * midnight must not become «23 декабря» on a computer west of Greenwich.
 */
export function formatDay(value: string, lang: "ru" | "en", now = new Date()): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const sameYear = date.getUTCFullYear() === now.getUTCFullYear();
  return date.toLocaleDateString(lang === "ru" ? "ru-RU" : "en-GB", {
    day: "numeric", month: "long", timeZone: "UTC", ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** «590 ₽», not «590,00 ₽»: kopecks are written only when there are some. */
export function formatSum(minor: number, currency: string, lang: "ru" | "en"): string {
  const whole = minor % 100 === 0;
  return new Intl.NumberFormat(lang === "ru" ? "ru-RU" : "en-GB", {
    style: "currency", currency, currencyDisplay: "narrowSymbol",
    minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2,
  }).format(minor / 100);
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
 * `spec/billing.md` §8.5), shown as floating messages of the page's toaster: an admin
 * whose renewal failed learns the day the space moves to Free, with one action; a member
 * of a suspended space learns why rooms are read-only and who can change it. During the
 * grace members see nothing: nothing has changed for them.
 *
 * Both stay until closed (a warning is never timed out). Closing hides the message for
 * this browser session and this state only: the next session, or a new grace end, shows
 * it again. When the state is gone — paid, or another space opened — it leaves by itself.
 *
 * A server without billing answers `404`, and there is simply no message.
 */
export function BillingStatusNotice({ orgId, onOpenBilling }: { orgId: string | null; onOpenBilling: () => void }) {
  const { t, lang } = useI18n();
  const { notify, dismiss } = useNotices();
  const [billing, setBilling] = useState<OrgBilling | null>(null);
  const openBilling = useRef(onOpenBilling);
  openBilling.current = onOpenBilling;

  useEffect(() => {
    setBilling(null);
    if (!orgId) return;
    let alive = true;
    billingApi.org(orgId).then((summary) => { if (alive) setBilling(summary); }).catch(() => {});
    return () => { alive = false; };
  }, [orgId]);

  const plan = billing ? t(PLAN_KEY[billing.subscription?.plan ?? billing.plan] ?? "billing.plan.free") : "";
  const state = !billing || !orgId
    ? null
    : billing.viewerIsAdmin && billing.status === "past_due" && billing.graceEnd
      ? { key: `past_due:${billing.graceEnd}`, tone: "warning" as const,
          body: t("billing.banner.pastDue", { plan, date: formatDay(billing.graceEnd, lang) }),
          action: { label: t("billing.banner.updateCard") } }
      : !billing.viewerIsAdmin && billing.status === "suspended"
        ? { key: "suspended", tone: "info" as const, body: t("billing.banner.memberFree"), action: undefined }
        : null;
  const id = orgId ? `billing-state:${orgId}` : "billing-state";
  const hiddenKey = state ? `${orgId}.${state.key}` : null;
  // Primitives only: the message is re-shown when its words change, not on every render.
  const tone = state?.tone ?? null;
  const body = state?.body ?? "";
  const actionLabel = state?.action?.label ?? null;

  useEffect(() => {
    if (!tone || !hiddenKey || readHidden(hiddenKey)) return;
    notify("billing", {
      id,
      tone,
      body,
      action: actionLabel ? { label: actionLabel, onClick: () => openBilling.current() } : undefined,
      duration: null,
      onClose: () => writeHidden(hiddenKey),
    });
    return () => dismiss(id);
  }, [id, hiddenKey, tone, body, actionLabel, notify, dismiss]);

  return null;
}

const NOTICE_PREFIX = "remo.billingNotice.";

function noticeKey(state: string) {
  return `${NOTICE_PREFIX}${state}`;
}

/** Session-scoped "closed" marks; storage may be unavailable, and then nothing is remembered. */
function readHidden(state: string): boolean {
  try { return window.sessionStorage.getItem(noticeKey(state)) === "1"; } catch { return false; }
}

function writeHidden(state: string): void {
  try { window.sessionStorage.setItem(noticeKey(state), "1"); } catch { /* the message simply returns next time */ }
}
