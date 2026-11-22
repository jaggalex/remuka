/**
 * The second factor's letters (`spec/totp.md` §7, `spec/operator-actions.md` §6).
 *
 * One place queues them, so the address rules are not repeated per route: the zone's
 * support mailbox and, when the installation has one, the security mailbox. The letters are
 * best-effort — a mail outage must never undo a factor that was just enabled or reset — and
 * the caller reports a missed letter in its own answer or journal.
 *
 * The secret and `otpauth://` never appear here: a letter says what happened and where to
 * write, not how to generate a code.
 */
import { securityContact, supportContact } from "./compliance.mjs";
import { assertMailConfig, enqueueMail, resolveMailConfig } from "./mail.mjs";

/** The one time line every letter carries; UTC so a server's zone cannot mislead. */
export function mfaLetterDate(now = new Date(), locale = "ru") {
  const at = now instanceof Date ? now : new Date(now);
  const text = new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(at);
  return `${text} UTC`;
}

/**
 * @returns {Promise<{ queued: boolean, reason?: string }>} never throws
 */
export async function queueMfaLetter({
  store,
  userId = null,
  toEmail,
  locale = "ru",
  template,
  params = {},
  config = null,
  env = process.env,
  now = new Date(),
} = {}) {
  if (!toEmail) return { queued: false, reason: "no_address" };
  let resolved = config;
  if (!resolved) {
    try {
      resolved = assertMailConfig(resolveMailConfig(env));
    } catch (error) {
      return { queued: false, reason: error.message ?? "mail_not_configured" };
    }
  }
  if (resolved.driver === "disabled") return { queued: false, reason: "mail_disabled" };
  const support = supportContact(env);
  const security = securityContact(env);
  try {
    await enqueueMail(
      store,
      {
        userId,
        toEmail,
        template,
        locale: locale === "en" ? "en" : "ru",
        params: {
          ...params,
          date: mfaLetterDate(now, locale),
          settingsUrl: `${resolved.appOrigin}/`,
          ...(support ? { support } : {}),
          ...(security ? { security } : {}),
        },
      },
      { config: resolved },
    );
    return { queued: true };
  } catch (error) {
    return { queued: false, reason: error.message ?? "mail_error" };
  }
}
