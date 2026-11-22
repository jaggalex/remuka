/**
 * The `remo_consent` cookie value (ADR-255, `spec/cookies.md` §4).
 *
 * One format, one parser: the browser reads the cookie itself, the service validates the
 * same string, and neither side is allowed to invent a second encoding. The value carries
 * no person and no timestamp — the browser's `Max-Age` is the expiry — and only the
 * optional tracking categories, because `necessary` cannot be turned off.
 *
 *   v1.<zone>.<policyVersion>.<choices>          v1.eu.2026-11.am
 *
 * `choices` is the granted categories in a fixed order (`a` analytics, `m` marketing), or
 * `-` when nothing optional was granted. The zone is never `none`: that installation has
 * no consent mechanism and sets no cookie (§3).
 */
import { POLICY_VERSION } from "./registry.mjs";
import { consentPolicy } from "./zones.mjs";

/** The cookie name the registry, the service and the client all use (§2). */
export const CONSENT_COOKIE = "remo_consent";

/** The only value version this parser understands. */
export const CONSENT_COOKIE_VERSION = "v1";

/**
 * The optional categories this cookie may carry. `preferences` is not here: a choice the
 * person made for themselves is necessary in both zones and is not asked about (§2).
 */
export const CONSENT_CHOICE_CATEGORIES = Object.freeze(["analytics", "marketing"]);

/** One letter per category, in the order the value lists them. */
const CATEGORY_CODES = Object.freeze({ analytics: "a", marketing: "m" });
const CODE_CATEGORIES = Object.freeze({ a: "analytics", m: "marketing" });

/** No optional category was granted. */
const NONE = "-";

/** A policy revision that fits one dot-separated field of the cookie. */
const VERSION_TOKEN = /^[0-9A-Za-z][0-9A-Za-z_-]{0,31}$/;

/** Whether a string can name a policy revision in a cookie. */
export function isPolicyVersion(value) {
  return typeof value === "string" && VERSION_TOKEN.test(value);
}

/**
 * How long a choice lives in this zone, in seconds, or `null` where there is no cookie.
 *
 * The number comes from `choiceTtlDays` in the zone data, so a lawyer changing the window
 * changes `Max-Age` and the policy page together (§3).
 */
export function consentCookieMaxAge(zone) {
  const days = consentPolicy(zone).choiceTtlDays;
  return days === null ? null : days * 24 * 60 * 60;
}

/** The wall-clock expiry of a new choice, as the API answers it, or `null`. */
export function consentCookieExpiresAt(zone, now = Date.now()) {
  const maxAge = consentCookieMaxAge(zone);
  return maxAge === null ? null : new Date(now + maxAge * 1000).toISOString();
}

/**
 * The cookie value for a zone and a choice.
 *
 * Unknown keys are ignored and `necessary` is never written: a cookie cannot claim a
 * category the service does not recognise, and it cannot turn necessary storage off.
 * An unknown zone or a malformed policy revision throws — both are programming errors.
 */
export function encodeConsentValue({
  zone,
  policyVersion = POLICY_VERSION,
  choices = {},
}) {
  if (zone !== "eu" && zone !== "ru") {
    throw new Error(`the consent cookie exists only in eu and ru; got ${JSON.stringify(zone)}`);
  }
  if (!isPolicyVersion(policyVersion)) {
    throw new Error(`bad consent policy version ${JSON.stringify(policyVersion)}`);
  }
  const granted = CONSENT_CHOICE_CATEGORIES.filter((category) => choices?.[category] === true)
    .map((category) => CATEGORY_CODES[category])
    .join("");
  return `${CONSENT_COOKIE_VERSION}.${zone}.${policyVersion}.${granted || NONE}`;
}

/**
 * A checked cookie value, or `null` when it is missing, from another deployment's zone,
 * truncated or corrupted.
 *
 * `null` is the safe answer: the visitor is treated as having made no choice, which means
 * necessary storage works and optional tracking stays off (§1 rule 2). Unknown letters,
 * duplicate letters and a zone `none` are all corrupt input, not a guess.
 */
export function parseConsentValue(raw) {
  if (typeof raw !== "string") return null;
  const parts = raw.split(".");
  if (parts.length !== 4) return null;
  const [version, zone, policyVersion, encoded] = parts;
  if (version !== CONSENT_COOKIE_VERSION) return null;
  if (zone !== "eu" && zone !== "ru") return null;
  if (!isPolicyVersion(policyVersion)) return null;
  if (encoded === "") return null;

  const choices = Object.fromEntries(CONSENT_CHOICE_CATEGORIES.map((name) => [name, false]));
  if (encoded !== NONE) {
    for (const letter of encoded) {
      const category = CODE_CATEGORIES[letter];
      if (!category || choices[category]) return null;
      choices[category] = true;
    }
  }
  return Object.freeze({
    version,
    zone,
    policyVersion,
    choices: Object.freeze(choices),
  });
}
