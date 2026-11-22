/**
 * One wording for every refusal the second-factor screens can get (`spec/totp.md` §8).
 *
 * Statuses and codes are the server's, never guessed from a message. Two screens ask for a
 * code and one asks for a password, so the helper knows which of the two "wrong" sentences
 * fits instead of letting each form invent its own.
 */
import { ApiError } from "../apiCall";
import type { TranslationKey } from "../i18n";

export function mfaErrorText(
  error: unknown,
  t: (key: TranslationKey) => string,
  { password = false } = {},
): string {
  if (!(error instanceof ApiError)) return t("mfa.failed");
  if (error.code === "INVALID_CREDENTIALS") {
    return t(password ? "mfa.wrongPassword" : "mfa.wrong");
  }
  if (error.code === "MFA_INVALID") return t("mfa.wrong");
  if (error.code === "MFA_LOCKED") return t("mfa.locked");
  if (error.code === "RATE_LIMITED") return t("mfa.rate");
  if (error.code === "MFA_UNAVAILABLE") return t("mfa.unavailable");
  if (error.code === "MFA_OPERATOR_ROLE") return t("mfa.operatorRole");
  return t("mfa.failed");
}
