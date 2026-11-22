/**
 * The rules of a compliance zone, as data (ADR-255, `spec/cookies.md` §3).
 *
 * The service reads `REMO_COMPLIANCE_ZONE` once and passes the zone down; a component never
 * decides what a zone means. The zone comes from configuration, never from IP geolocation
 * (§1 rule 5), so the same build behaves the same for every visitor of a deployment.
 *
 * | rule                         | eu          | ru          | none |
 * | notice when only necessary   | no          | one line    | no   |
 * | banner when analytics exists | yes         | yes         | no   |
 * | optional tracking enabled    | yes         | yes         | no   |
 * | Global Privacy Control is no | yes         | yes         | —    |
 * | choice lifetime              | 6 months    | 12 months   | —    |
 * | consent log for signed-in    | yes         | yes         | no   |
 *
 * `preferences` is not a rule but a fact: it is necessary in every zone, because the
 * person chose those settings and the EDPB reading puts a requested setting outside
 * consent (§2). It is never asked, so no zone has a switch for it.
 */
import {
  CATEGORIES,
  CATEGORY_RULES,
  STORAGE_REGISTRY,
  categoryCanBeDisabled,
  hasOptionalTracking,
} from "./registry.mjs";

/** The values `REMO_COMPLIANCE_ZONE` accepts. */
export const ZONES = Object.freeze(["eu", "ru", "none"]);

/**
 * One policy per zone. The defaults today follow the EDPB reading that a choice the person
 * made themselves is necessary, and `preferences` is therefore never asked in any zone
 * (§2, §6): the registry keeps the category, the interface does not offer it.
 */
export const ZONE_POLICY = Object.freeze({
  eu: Object.freeze({
    zone: "eu",
    noticeWhenNecessaryOnly: false,
    consentBannerWhenOptional: true,
    optionalTrackingEnabled: true,
    respectGlobalPrivacyControl: true,
    choiceTtlDays: 180,
    logConsentForSignedIn: true,
    personalDataConsentLink: false,
  }),
  ru: Object.freeze({
    zone: "ru",
    noticeWhenNecessaryOnly: true,
    consentBannerWhenOptional: true,
    optionalTrackingEnabled: true,
    respectGlobalPrivacyControl: true,
    choiceTtlDays: 365,
    logConsentForSignedIn: true,
    personalDataConsentLink: true,
  }),
  none: Object.freeze({
    zone: "none",
    noticeWhenNecessaryOnly: false,
    consentBannerWhenOptional: false,
    optionalTrackingEnabled: false,
    respectGlobalPrivacyControl: false,
    choiceTtlDays: null,
    logConsentForSignedIn: false,
    personalDataConsentLink: false,
  }),
});

/** Whether a string is one of the zones the product understands. */
export function isComplianceZone(zone) {
  return ZONES.includes(zone);
}

/**
 * The zone of this deployment: `REMO_COMPLIANCE_ZONE` is `eu`, `ru` or `none`.
 *
 * A missing or blank variable is the self-host default (`none`): an operator who has not
 * chosen a zone must not get a banner that assumes one. A typo is different — it throws, so
 * a mistyped `REMO_COMPLIANCE_ZONE=euu` cannot silently turn the EU rules off.
 */
export function resolveConsentZone(env = globalThis.process?.env ?? {}) {
  const raw = env?.REMO_COMPLIANCE_ZONE;
  if (raw === undefined || raw === null || String(raw).trim() === "") return "none";
  const zone = String(raw).trim().toLowerCase();
  if (!isComplianceZone(zone)) {
    throw new Error(
      `REMO_COMPLIANCE_ZONE must be one of ${ZONES.join(", ")}; got ${JSON.stringify(raw)}`,
    );
  }
  return zone;
}

/** The policy of a zone. An unknown zone is a programming error, not a quiet default. */
export function consentPolicy(zone) {
  const policy = ZONE_POLICY[zone];
  if (!policy) {
    throw new Error(`unknown compliance zone ${JSON.stringify(zone)}; one of ${ZONES.join(", ")}`);
  }
  return policy;
}

/**
 * The choices a first-time visitor starts with: necessary on, tracking off (§1 rule 3).
 *
 * `preferences` follows its registry rule and stays on: it is necessary in every zone, so
 * no zone policy can change this and the function takes no argument.
 */
function choicesFor() {
  const choices = {};
  for (const category of CATEGORIES) {
    const rule = CATEGORY_RULES[category];
    if (!rule) throw new Error(`unknown category ${JSON.stringify(category)}`);
    // Only tracking starts off; `preferences` is necessary storage like `necessary`.
    const tracking = category === "analytics" || category === "marketing";
    choices[category] = !rule.disabledByDefault && !tracking;
  }
  return Object.freeze(choices);
}

/** The choices a first-time visitor starts with in this zone. */
export function defaultChoices(zone) {
  // Reading the policy keeps an unknown zone an error instead of a silent default.
  consentPolicy(zone);
  return choicesFor();
}

/**
 * A choice read from the `remo_consent` cookie or the banner, made safe for the zone.
 *
 * `necessary` and `preferences` are always on: a choice cannot switch off the storage the
 * requested service needs, and `preferences` is that storage (§2). In the `none` zone
 * optional tracking stays off, because there is no mechanism to ask for it. An unknown key
 * in `choices` is ignored rather than trusted.
 */
export function normalizeChoices(zone, choices = {}) {
  const policy = consentPolicy(zone);
  const next = { ...choicesFor() };
  for (const category of CATEGORIES) {
    // Only the two tracking categories are a question; everything else is already on.
    if (category !== "analytics" && category !== "marketing") continue;
    next[category] =
      policy.optionalTrackingEnabled && typeof choices[category] === "boolean"
        ? choices[category]
        : false;
  }
  return Object.freeze(next);
}

/** §3 row 1: the short notice appears only where the registry has nothing optional. */
export function showConsentNotice(zone, registry = STORAGE_REGISTRY) {
  return consentPolicy(zone).noticeWhenNecessaryOnly && !hasOptionalTracking(registry);
}

/** §3 row 2: the banner is needed exactly when an optional tracking category exists. */
export function showConsentBanner(zone, registry = STORAGE_REGISTRY) {
  return consentPolicy(zone).consentBannerWhenOptional && hasOptionalTracking(registry);
}

/**
 * The zone data's own invariants, as text lines for the gate and the tests.
 *
 * A missing zone, a non-boolean flag or a policy that would let `necessary` be switched off
 * is a data defect: the UI reads these fields without a second check.
 */
export function validateZonePolicies(policies = ZONE_POLICY) {
  const problems = [];
  const keys = Object.keys(policies);
  for (const zone of ZONES) {
    if (!keys.includes(zone)) problems.push(`zone ${zone}: missing policy`);
  }
  for (const key of keys) {
    if (!isComplianceZone(key)) {
      problems.push(`zone ${JSON.stringify(key)}: unknown zone`);
      continue;
    }
    const policy = policies[key];
    if (!policy || policy.zone !== key) {
      problems.push(`zone ${key}: policy.zone must be ${JSON.stringify(key)}`);
      continue;
    }
    for (const flag of [
      "noticeWhenNecessaryOnly",
      "consentBannerWhenOptional",
      "optionalTrackingEnabled",
      "respectGlobalPrivacyControl",
      "logConsentForSignedIn",
      "personalDataConsentLink",
    ]) {
      if (typeof policy[flag] !== "boolean") problems.push(`zone ${key}: ${flag} must be a boolean`);
    }
    if (
      policy.choiceTtlDays !== null &&
      !(Number.isInteger(policy.choiceTtlDays) && policy.choiceTtlDays > 0)
    ) {
      problems.push(`zone ${key}: choiceTtlDays must be a positive whole number of days or null`);
    }
    if (choicesFor().necessary !== true) {
      problems.push(`zone ${key}: necessary cannot be disabled`);
    }
  }
  if (categoryCanBeDisabled("necessary")) {
    problems.push("category necessary: must not be disableable");
  }
  return problems;
}
