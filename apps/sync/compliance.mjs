/**
 * The compliance zone, the cookie policy link and the personal-data consent link of this
 * installation (ADR-255, `spec/cookies.md` §3).
 *
 * The zone is a deployment fact, not a per-visitor guess: `REMO_COMPLIANCE_ZONE` is read
 * once at start and `GET /config` carries the answer to the browser. A self-host that sets
 * nothing gets `none`, so an operator who has not decided is not shown rules that assume a
 * jurisdiction. A typo stops the start instead of silently turning the rules off;
 * `resolveConsentZone` owns that decision.
 *
 * The policy link is optional and belongs to the zone: with no zone there is nothing that
 * would show it, so a lone `REMO_COOKIE_POLICY_URL` is one warning at start and an empty
 * field. A malformed address is dropped for the same reason — it would end up in a link in
 * the consent banner.
 *
 * `REMO_PERSONAL_DATA_CONSENT_URL` is the second optional address: the separate document of
 * consent to personal-data processing that Russian law asks for (156-ФЗ). It is published
 * only in a zone whose rules show it (`personalDataConsentLink`), and only when the operator
 * set a usable address, so the interface shows the link exactly when the document exists.
 */
import { BRAND } from "@remo/brand";
import { consentPolicy, resolveConsentZone } from "@remo/consent";

/** An absolute `https` address with a host, or null. A path, query and fragment are fine. */
export function cookiePolicyUrl(raw) {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    if (!url.hostname) return null;
    if (url.username || url.password) return null;
    return url.href;
  } catch {
    // A malformed address is ignored rather than written into a policy link.
    return null;
  }
}

/** The complaint address of the installation's zone (`spec/operator.md` §4, ADR-259). */
export function abuseContact(env = globalThis.process?.env ?? {}) {
  const configured = String(env?.REMO_CONTACT_ABUSE ?? "").trim();
  if (configured) return /^[^@\s<>,;]+@[^@\s<>,;]+$/.test(configured) ? configured : null;
  const zone = resolveConsentZone(env);
  if (zone === "ru") return `abuse@${BRAND.domains.siteRu}`;
  if (zone === "eu") return `abuse@${BRAND.domains.site}`;
  // A self-host without a zone names its own mailbox; a wrong default would send appeals
  // to somebody else's service.
  return null;
}

/** A mailbox only when it looks like one: a letter footer must not print a typo. */
function mailbox(value) {
  const text = String(value ?? "").trim();
  return /^[^@\s<>,;]+@[^@\s<>,;]+$/.test(text) ? text : null;
}

/**
 * The support address of the installation's zone (`spec/account-deletion.md` §4).
 *
 * The second factor's letters tell a person where to write when something is wrong with
 * their account. A self-host names its own mailbox with `REMO_CONTACT_SUPPORT`; without
 * one, the templates leave the line out rather than printing somebody else's address.
 */
export function supportContact(env = globalThis.process?.env ?? {}) {
  const configured = mailbox(env?.REMO_CONTACT_SUPPORT);
  if (configured) return configured;
  const zone = resolveConsentZone(env);
  if (zone === "ru") return `support@${BRAND.domains.siteRu}`;
  if (zone === "eu") return `support@${BRAND.domains.site}`;
  return null;
}

/**
 * The security mailbox: one address for both cloud installations, because a vulnerability
 * concerns the shared code (`spec/account-deletion.md` §4). A self-host sets its own.
 */
export function securityContact(env = globalThis.process?.env ?? {}) {
  const configured = mailbox(env?.REMO_CONTACT_SECURITY);
  if (configured) return configured;
  const zone = resolveConsentZone(env);
  if (zone === "ru" || zone === "eu") return `security@${BRAND.domains.site}`;
  return null;
}

/**
 * What `GET /config` publishes: the zone, the policy page the notice links to and, in a
 * zone that shows it, the personal-data consent document.
 *
 * Every field is present on every answer: `null` means "there is nothing to link", so the
 * client never has to guess whether a missing key is an older service or an absent document.
 * `policyUrl` is `null` in the `none` zone and whenever the variable is missing or cannot be
 * used. `personalDataConsentUrl` is `null` in the same cases and additionally in a zone whose
 * rules do not show that link (`eu`).
 */
export function resolveCompliance(env = globalThis.process?.env ?? {}) {
  const zone = resolveConsentZone(env);
  if (zone === "none") return { zone, policyUrl: null, personalDataConsentUrl: null };
  return {
    zone,
    policyUrl: cookiePolicyUrl(env?.REMO_COOKIE_POLICY_URL),
    personalDataConsentUrl: consentPolicy(zone).personalDataConsentLink
      ? cookiePolicyUrl(env?.REMO_PERSONAL_DATA_CONSENT_URL)
      : null,
  };
}

/**
 * One warning at start when a compliance link cannot be used.
 *
 * An unset variable is the normal state and says nothing. A URL next to the default zone is
 * a configuration mistake worth one line, and so is an address that is not absolute https.
 * The personal-data document has one more case: a zone whose rules do not show it (`eu`)
 * publishes nothing even though the address is valid.
 */
export function warnCompliance(env = globalThis.process?.env ?? {}, log = console.warn) {
  const policy = String(env?.REMO_COOKIE_POLICY_URL ?? "").trim();
  const personal = String(env?.REMO_PERSONAL_DATA_CONSENT_URL ?? "").trim();
  if (!policy && !personal) return;
  let zone;
  try {
    zone = resolveConsentZone(env);
  } catch {
    // A mistyped zone already stopped the start; this warning never reports it twice.
    return;
  }
  if (zone === "none") {
    if (policy) {
      log(
        "[sync] compliance: REMO_COOKIE_POLICY_URL is set while REMO_COMPLIANCE_ZONE is none; no cookie policy link is published",
      );
    }
    if (personal) {
      log(
        "[sync] compliance: REMO_PERSONAL_DATA_CONSENT_URL is set while REMO_COMPLIANCE_ZONE is none; no personal-data consent link is published",
      );
    }
    return;
  }
  if (policy && !cookiePolicyUrl(policy)) {
    log(
      "[sync] compliance: REMO_COOKIE_POLICY_URL must be an absolute https address; the cookie policy link stays empty",
    );
  }
  if (!personal) return;
  if (!consentPolicy(zone).personalDataConsentLink) {
    log(
      `[sync] compliance: REMO_PERSONAL_DATA_CONSENT_URL is set but the ${zone} zone shows no personal-data consent link; nothing is published`,
    );
    return;
  }
  if (!cookiePolicyUrl(personal)) {
    log(
      "[sync] compliance: REMO_PERSONAL_DATA_CONSENT_URL must be an absolute https address; the personal-data consent link stays empty",
    );
  }
}
