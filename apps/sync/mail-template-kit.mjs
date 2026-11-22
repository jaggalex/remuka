/**
 * Shared pieces of the transactional letters (ADR-246, `spec/mail.md` §6).
 *
 * The copy lives in the renderers; this module holds only what several of them need: the
 * parameter reader, the HTML shell, the brand's Russian case and the button labels. It has
 * no template list and no `render`, so an invitation can live in its own module without a
 * second copy of the escaping rules.
 */
import { brandNameCase } from "@remo/brand";

const LOCALES = ["ru", "en"];

export { LOCALES };

export const BUTTON_LABELS = {
  ru: {
    verify_email: "Подтвердить почту",
    password_reset: "Задать новый пароль",
    password_changed: "Сбросить пароль",
    invitation: "Принять приглашение",
    payment_succeeded: "Посмотреть счёт",
    payment_failed: "Обновить способ оплаты",
    trial_ending: "Выбрать тариф",
    renewal_upcoming: "Проверить подписку",
    subscription_suspended: "Восстановить доступ",
    subscription_canceled: "Возобновить подписку",
    payment_method_expiring: "Обновить карту",
    price_change: "Посмотреть условия",
    payment_method_migrate: "Ввести карту заново",
    account_deletion: "Отменить удаление",
    legal_update: "Прочитать документ",
    payment_refunded: "Посмотреть счёт",
    operator_action: "Ответить",
    mfa_settings: "Открыть настройки",
  },
  en: {
    verify_email: "Confirm email",
    password_reset: "Set a new password",
    password_changed: "Reset password",
    invitation: "Accept invitation",
    payment_succeeded: "View invoice",
    payment_failed: "Update payment method",
    trial_ending: "Choose a plan",
    renewal_upcoming: "Review subscription",
    subscription_suspended: "Restore access",
    subscription_canceled: "Resume subscription",
    payment_method_expiring: "Update card",
    price_change: "Review terms",
    payment_method_migrate: "Enter card again",
    account_deletion: "Cancel deletion",
    legal_update: "Read the document",
    payment_refunded: "View invoice",
    operator_action: "Reply",
    mfa_settings: "Open settings",
  },
};

const FONT_FAMILY = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

const HTML_ESCAPES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * Template failures are programmer errors, not delivery failures: a missing link cannot be
 * retried, so they never become a `MailError` with `retryable`.
 */
export function templateError(code, param) {
  const error = new Error(param ? `${code}: ${param}` : code);
  error.code = code;
  if (param) error.param = param;
  return error;
}

/**
 * A single-line field. Newlines are removed because a subject or a name must not be able to
 * split a line, and an empty value is treated as absent rather than rendered as a hole.
 */
function singleLine(value) {
  return String(value).replace(/[\r\n]+/g, " ").trim();
}

export function param(params, name, { required = true } = {}) {
  const raw = params[name];
  if (raw === undefined || raw === null) {
    if (required) throw templateError("MISSING_PARAM", name);
    return null;
  }
  if (typeof raw !== "string" && typeof raw !== "number") {
    // An object would stringify to `[object Object]` and a boolean to `true`; neither is a
    // substitute value a reader should ever receive.
    if (required) throw templateError("MISSING_PARAM", name);
    return null;
  }
  const value = singleLine(raw);
  if (!value) {
    if (required) throw templateError("MISSING_PARAM", name);
    return null;
  }
  return value;
}

/**
 * The product name as a Russian sentence needs it (`spec/rebrand.md` §4.3).
 *
 * The brand declines; an installation's own name does not, so it is wrapped in the
 * «в сервисе {product}» construction with the service word in the required case. English
 * needs no case at all.
 */
const RU_SERVICE = {
  nominative: "сервис",
  genitive: "сервиса",
  dative: "сервису",
  accusative: "сервис",
  instrumental: "сервисом",
  prepositional: "сервисе",
};

export function ruNoun(lang, values, grammaticalCase) {
  if (lang !== "ru") return values.product;
  if (values.ownProduct) return `${RU_SERVICE[grammaticalCase]} ${values.product}`;
  return brandNameCase({ locale: "ru", grammaticalCase });
}

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => HTML_ESCAPES[character]);
}

export function documentHtml({ lang, paragraphs, footer, link, label }) {
  const href = escapeHtml(link);
  const rows = paragraphs
    .map((paragraph) => `              <p style="margin:0 0 16px;">${paragraph}</p>`)
    .join("\n");
  const footerHtml = footer
    ? `\n              <p style="margin:0;font-size:14px;line-height:1.5;color:#57534e;">${footer}</p>`
    : "";
  return `<!doctype html>
<html lang="${lang}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
  </head>
  <body style="margin:0;padding:0;background-color:#f5f5f4;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f5f5f4;">
      <tr>
        <td align="center" style="padding:24px 12px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background-color:#ffffff;border-radius:8px;">
            <tr>
              <td style="padding:24px;font-family:${FONT_FAMILY};font-size:16px;line-height:1.5;color:#1c1917;">
${rows}
                <p style="margin:0 0 24px;">
                  <a href="${href}" style="display:inline-block;padding:12px 20px;border-radius:6px;background-color:#1c1917;color:#ffffff;text-decoration:none;font-weight:600;">${label}</a>
                </p>
                <p style="margin:0 0 16px;font-size:14px;line-height:1.4;color:#57534e;word-break:break-all;">
                  <a href="${href}" style="color:#57534e;">${escapeHtml(link)}</a>
                </p>${footerHtml}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function notification(lang, { subject, body, action, notice, link, label }) {
  return {
    subject,
    text: `${body.join(" ")} ${action} ${link}\n\n${notice}`,
    html: documentHtml({
      lang,
      paragraphs: body.map(escapeHtml),
      footer: escapeHtml(notice),
      link,
      label: escapeHtml(label),
    }),
  };
}

/**
 * Billing amounts arrive as a display string the caller already formatted ("290,00 ₽");
 * the template never guesses a currency or appends the ISO code, or the sum would read
 * "290,00 ₽ RUB". `currency` is still required so a caller cannot quietly drop it.
 */
export function money(values, name = "amount") {
  const amount = param(values, name);
  param(values, "currency");
  return amount;
}
