/**
 * The compliance zone, the cookie policy link and the personal-data consent link from
 * `GET /config` (ADR-255, `spec/cookies.md` §3).
 *
 * The service decides the zone once at start; the browser only carries the answer to the
 * notice, the banner and the settings of stage 4. Nothing is shown from this module: it
 * turns an untrusted JSON field into a shape a component can read without a second check.
 * Anything unknown is the safe `none` zone, and a link is only kept when it is an absolute
 * `https` address, so a broken answer cannot become a `javascript:` link.
 */

/** The zones `REMO_COMPLIANCE_ZONE` accepts. */
export type ComplianceZone = "eu" | "ru" | "none";

/**
 * What the rest of the app reads: the zone, the policy page and the separate personal-data
 * consent document, when the installation has them.
 */
export interface ComplianceInfo {
  readonly zone: ComplianceZone;
  readonly policyUrl: string | null;
  /** `REMO_PERSONAL_DATA_CONSENT_URL`; published only in a zone that shows it (§3). */
  readonly personalDataConsentUrl: string | null;
}

/** The self-host default: no zone means no notice, no banner and no policy link. */
export const NO_COMPLIANCE: ComplianceInfo = Object.freeze({
  zone: "none",
  policyUrl: null,
  personalDataConsentUrl: null,
});

/** Whether a value names a zone the product understands. */
export function isComplianceZone(value: unknown): value is ComplianceZone {
  return value === "eu" || value === "ru" || value === "none";
}

/** An absolute `https` address, or null for anything else. Both compliance links share it. */
function httpsUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !url.hostname) return null;
    if (url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

/**
 * The compliance field of `/config`, made safe.
 *
 * A missing route, an older service or a malformed body all answer `none`: a browser that
 * cannot tell the zone must behave like a self-host that chose none, never like the EU.
 */
export function readCompliance(value: unknown): ComplianceInfo {
  if (!value || typeof value !== "object") return NO_COMPLIANCE;
  const {
    zone,
    policyUrl: rawPolicy,
    personalDataConsentUrl: rawPersonal,
  } = value as { zone?: unknown; policyUrl?: unknown; personalDataConsentUrl?: unknown };
  if (!isComplianceZone(zone) || zone === "none") return NO_COMPLIANCE;
  return {
    zone,
    policyUrl: httpsUrl(rawPolicy),
    // A service that predates the field answers nothing; the link is simply absent.
    personalDataConsentUrl: httpsUrl(rawPersonal),
  };
}
