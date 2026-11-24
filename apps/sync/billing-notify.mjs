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
  return async function notify(type, { orgId, invoice, failureCode } = {}) {
    if (!mailConfig || mailConfig.driver === "disabled") return;
    const account = orgId
      ? await store.withTenant(orgId, () => store.billingAccount(orgId))
      : null;
    const toEmail = account?.billing_email;
    if (!toEmail) return;

    const at = now();
    const amount = invoice ? `${Number(invoice.total) / 100} ${invoice.currency}` : "";
    const params = {
      amount,
      currency: invoice?.currency ?? "",
      period: invoice?.period_end
        ? new Date(invoice.period_end).toISOString().slice(0, 10)
        : "",
      retryAt: new Date(at.getTime() + 24 * 3600_000).toISOString().slice(0, 10),
      date: at.toISOString().slice(0, 10),
      invoiceUrl: `${mailConfig.appOrigin}/?billing=1`,
      billingUrl: `${mailConfig.appOrigin}/?billing=1`,
      failureCode: failureCode ?? "",
    };
    // Amount-bearing templates read the same `amount`; a suspension letter ignores it.
    if (AMOUNT_TYPES.has(type) && !invoice) params.amount = "";

    await enqueueMail(
      store,
      { toEmail, template: type, locale: "ru", params },
      { config: mailConfig, kek: kek ?? kekFromEnv() },
    );
  };
}
