/**
 * Billing letters (ADR-246, ADR-247 §3.3, ADR-319; `spec/billing.md` §3.3, §7).
 *
 * A renewal and a provider webhook change money in different files, but the letter that
 * follows is the same: the payer must learn about a purchase, a renewal, a failure, a
 * suspension or a change the same way. This module is that one letter factory; the caller
 * decides whether a failed letter is fatal (`safeNotify` in the renewal loop) or merely
 * logged (the inbox drain), and which event it is — never how the letter is worded.
 *
 * The address comes from `billing_accounts`, not from the payment: the shop returns no
 * email and the webhook has no session. No address means no letter, which is the honest
 * state, not an error that would block the money.
 *
 * Every letter has a deduplication key `(template, operation)`: the invoice for money
 * letters, the schedule step for reminders. The outbox id is derived from it, so five
 * deliveries of one webhook queue one letter (ADR-319 §4).
 */
import { createHash } from "node:crypto";
import { PLANS } from "./billing-catalog.mjs";
import { formatMailDate, formatMailMoney } from "./billing-format.mjs";
import { enqueueMail } from "./mail.mjs";
import { kekFromEnv } from "./secrets.mjs";

/** What the templates require for the amount-bearing events (§7). */
const AMOUNT_TYPES = new Set([
  "plan_activated",
  "payment_succeeded",
  "payment_failed",
  "payment_final_attempt",
  "payment_recovered",
  "payment_refunded",
  "renewal_upcoming",
  "trial_ending",
  "price_change",
]);

const PLAN_LABEL = {
  ru: { free: "Бесплатный", pro: "Pro", team: "Team", business: "Business" },
  en: { free: "Free", pro: "Pro", team: "Team", business: "Business" },
};

const PERSONAL = { ru: "Личное", en: "Personal" };

/** Provider codes that mean "the bank said no to this card" rather than "something failed". */
const DECLINED = new Set(["card_declined", "card_expired", "insufficient_funds", "declined", "payment_method_rejected"]);

export function planLabel(plan, lang) {
  return PLAN_LABEL[lang]?.[plan] ?? PLAN_LABEL.en[plan] ?? String(plan ?? "");
}

/** «28 декабря, 30 декабря и 3 января» — the remaining retries in words. */
function listOf(items, lang) {
  if (items.length <= 1) return items.join("");
  const and = lang === "ru" ? " и " : " and ";
  return `${items.slice(0, -1).join(", ")}${and}${items.at(-1)}`;
}

function reasonOf(failureCode, last4, lang) {
  const declined = DECLINED.has(String(failureCode ?? "")) && last4;
  if (lang === "ru") return declined ? `Банк отклонил карту •••• ${last4}` : "Платёж не прошёл";
  return declined ? `The bank declined card •••• ${last4}` : "The payment didn't go through";
}

/** A stable outbox id for one letter of one operation: a UUID-shaped SHA-256 prefix. */
export function letterId(template, key) {
  const hex = createHash("sha256").update(`billing-letter:${template}:${key}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function planOf(invoice, subscription) {
  const lines = Array.isArray(invoice?.lines) ? invoice.lines : [];
  return lines.find((line) => line?.kind === "subscription")?.plan ?? subscription?.plan ?? null;
}

export function createBillingNotify({
  store,
  mailConfig,
  kek = null,
  now = () => new Date(),
}) {
  /** `users.lang` of the payer, otherwise English (`spec/mail.md` §5.5): no request here. */
  async function localeFor(toEmail) {
    const lang = typeof store.mailLangByEmail === "function"
      ? await store.mailLangByEmail(toEmail)
      : null;
    return lang === "ru" || lang === "en" ? lang : "en";
  }

  async function factsFor(orgId) {
    if (typeof store.billingLetterFacts !== "function") return null;
    return store.billingLetterFacts(orgId);
  }

  /**
   * `schedule` is the renewal schedule of a past-due subscription (`retries`, `graceEnd`,
   * `finalAttempt`, all instants); `params` are event-specific values the caller already
   * formatted (a downgrade's impact sentence, a seat count); `dedupeKey` names the
   * operation. Without a key the letter is not deduplicated (a test, an operator command).
   */
  return async function notify(
    type,
    { orgId, invoice, subscription, failureCode, retryAt = null, schedule = null, params: extra = {}, dedupeKey = null, toEmail: to = null } = {},
  ) {
    if (!mailConfig || mailConfig.driver === "disabled") return;
    const account = orgId
      ? await store.withTenant(orgId, () => store.billingAccount(orgId))
      : null;
    const toEmail = to ?? account?.billing_email;
    if (!toEmail) return;

    const at = now();
    const locale = await localeFor(toEmail);
    const facts = orgId ? await factsFor(orgId) : null;
    const date = (value) => (value ? formatMailDate(value, locale, at) : "");
    const plan = planOf(invoice, subscription);
    const periodStart = invoice?.period_start ?? invoice?.periodStart;
    const periodEnd = invoice?.period_end ?? invoice?.periodEnd;
    const retries = (schedule?.retries ?? []).filter((time) => new Date(time) > at);
    const link = `${mailConfig.appOrigin}/?billing=1`;

    const params = {
      amount: invoice ? formatMailMoney(invoice.total, invoice.currency, locale) : "",
      currency: invoice?.currency ?? "",
      plan: plan ? planLabel(plan, locale) : "",
      space: facts ? (facts.kind === "personal" ? PERSONAL[locale] : facts.name) : "",
      last4: facts?.last4 ?? "",
      rooms: facts ? String(facts.rooms) : "",
      freeRooms: String(PLANS.free.rooms),
      invoice: invoice?.number ?? "",
      period: periodStart && periodEnd ? `${date(periodStart)} — ${date(periodEnd)}` : date(periodEnd),
      periodEnd: date(periodEnd),
      graceEnd: date(schedule?.graceEnd),
      retries: listOf(retries.map(date), locale),
      // The retry date belongs to the renewal schedule; the caller passes it (ADR-319 §3).
      retryAt: date(retryAt ?? retries[0]),
      reason: reasonOf(failureCode, facts?.last4, locale),
      date: date(type === "payment_final_attempt" ? schedule?.finalAttempt : at),
      spaceUrl: `${mailConfig.appOrigin}/`,
      invoiceUrl: link,
      billingUrl: link,
      failureCode: failureCode ?? "",
      ...extra,
    };
    // Amount-bearing templates read the same `amount`; a suspension letter ignores it.
    if (AMOUNT_TYPES.has(type) && !invoice && extra.amount === undefined) params.amount = "";

    await enqueueMail(
      store,
      {
        ...(dedupeKey ? { id: letterId(type, dedupeKey) } : {}),
        toEmail,
        template: type,
        locale,
        params,
      },
      { config: mailConfig, kek: kek ?? kekFromEnv() },
    );
  };
}
