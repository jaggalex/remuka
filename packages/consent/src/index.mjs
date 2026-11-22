/**
 * `@remo/consent` — the registry and the zone rules (ADR-255).
 *
 * Plain ESM with no build step, like `@remo/brand`: the app, the landing build, the guide and
 * `scripts/consent-check.mjs` import the same module. The consent gate itself (§5) arrives in
 * stage 3; this stage gives it one source of truth to read.
 */
export {
  CATEGORIES,
  CATEGORY_RULES,
  KINDS,
  OWNERS,
  POLICY_VERSION,
  STORAGE_REGISTRY,
  categoryCanBeDisabled,
  hasOptionalTracking,
  nameMatches,
  validateRegistry,
} from "./registry.mjs";

export {
  CONSENT_CHOICE_CATEGORIES,
  CONSENT_COOKIE,
  CONSENT_COOKIE_VERSION,
  consentCookieExpiresAt,
  consentCookieMaxAge,
  encodeConsentValue,
  isPolicyVersion,
  parseConsentValue,
} from "./cookie.mjs";

export {
  ZONES,
  ZONE_POLICY,
  consentPolicy,
  defaultChoices,
  isComplianceZone,
  normalizeChoices,
  resolveConsentZone,
  showConsentBanner,
  showConsentNotice,
  validateZonePolicies,
} from "./zones.mjs";
