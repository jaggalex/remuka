/**
 * Billing letters (ADR-246, ADR-247 §3.3, `spec/billing.md` §4, §7).
 *
 * A renewal and a provider webhook change money in different files, but the letter that
 * follows is the same: the payer must learn about a successful charge, a failure, a
 * suspension or a cancellation the same way. This module is that one letter factory; the
 * caller decides whether a failed letter is fatal (`safeNotify` in the renewal loop) or
 * merely logged (the inbox drain), never which template to use.
 *
 * The address comes from `billing_accounts`, not from the payment: the shop returns no
 * email and the webhook has no session. No address means no letter, which is the honest
 * state, not an error that would block the money.
 */
import { formatMailDate, formatMailMoney } from "./billing-format.mjs";
import { enqueueMail } from "./mail.mjs";
import { kekFromEnv } from "./secrets.mjs";

/** What the templates require for the amount-bearing events (§7). */
const AMOUNT_TYPES = new Set([
  "payment_succeeded",
  "payment_failed",
  "payment_refunded",
  "renewal_upcoming",
  "trial_ending",
  "price_change",
]);

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

  return async function notify(type, { orgId, invoice, failureCode, retryAt = null } = {}) {
    if (!mailConfig || mailConfig.driver === "disabled") return;
    const account = orgId
      ? await store.withTenant(orgId, () => store.billingAccount(orgId))
      : null;
    const toEmail = account?.billing_email;
    if (!toEmail) return;

    const at = now();
    const locale = await localeFor(toEmail);
    const date = (value) => (value ? formatMailDate(value, locale, at) : "");
    const params = {
      amount: invoice ? formatMailMoney(invoice.total, invoice.currency, locale) : "",
      currency: invoice?.currency ?? "",
      period: date(invoice?.period_end ?? invoice?.periodEnd),
      // The retry date belongs to the renewal schedule; the caller passes it (ADR-319 §3).
      retryAt: date(retryAt),
      date: date(at),
      invoiceUrl: `${mailConfig.appOrigin}/?billing=1`,
      billingUrl: `${mailConfig.appOrigin}/?billing=1`,
      failureCode: failureCode ?? "",
    };
    // Amount-bearing templates read the same `amount`; a suspension letter ignores it.
    if (AMOUNT_TYPES.has(type) && !invoice) params.amount = "";

    await enqueueMail(
      store,
      { toEmail, template: type, locale, params },
      { config: mailConfig, kek: kek ?? kekFromEnv() },
    );
  };
}
