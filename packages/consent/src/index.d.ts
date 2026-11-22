/**
 * Types for `@remo/consent` (ADR-255).
 *
 * The runtime is `src/index.mjs`: sync has no build step, so one plain module serves the
 * browser, the service, the documentation build and the gate. These declarations are the
 * contract those callers are checked against.
 */

/** The four categories of `spec/cookies.md` §2. */
export type ConsentCategory = "necessary" | "preferences" | "analytics" | "marketing";

/** Every kind of browser storage the product may use. */
export type StorageKind = "cookie" | "localStorage" | "sessionStorage" | "indexedDB" | "third-party";

/** Who sets a record: the service, the app, the docs build or the support frame. */
export type StorageOwner = "sync" | "web" | "support" | "docs";

/** The zones `REMO_COMPLIANCE_ZONE` accepts. */
export type ComplianceZone = "eu" | "ru" | "none";

/** A purpose in both interface languages, like the brand module's own strings. */
export interface LocalizedText {
  ru: string;
  en: string;
}

/** One record of the registry: a cookie, a storage key, a database or a third-party host. */
export interface StorageEntry {
  /** The exact key or cookie name; a trailing `*` is a prefix pattern. */
  readonly name: string;
  readonly kind: StorageKind;
  readonly category: ConsentCategory;
  readonly owner: StorageOwner;
  readonly purpose: Readonly<LocalizedText>;
  /** How long it lives, as the policy page shows it. */
  readonly lifetime: string;
  /** Cookies only: whether the app's JavaScript cannot read it. */
  readonly httpOnly?: boolean;
}

/** What one category means for a choice. */
export interface CategoryRule {
  readonly optional: boolean;
  readonly disabledByDefault: boolean;
}

/** The registry and the categories, in one place. */
export declare const CATEGORIES: readonly ConsentCategory[];

/**
 * The edition of the cookie policy and of the registry; part of the `remo_consent` value
 * and of every journal row (§4). Never contains a dot.
 */
export declare const POLICY_VERSION: string;

export declare const KINDS: readonly StorageKind[];
export declare const OWNERS: readonly StorageOwner[];
export declare const CATEGORY_RULES: Readonly<Record<ConsentCategory, CategoryRule>>;
export declare const STORAGE_REGISTRY: readonly StorageEntry[];

/** Registry invariants as text lines; empty means valid. */
export declare function validateRegistry(registry?: readonly StorageEntry[]): string[];

/** Whether a registry pattern covers a name found in code; either side may hold a `*`. */
export declare function nameMatches(pattern: string, name: string): boolean;

/** False for `necessary`; an unknown category is also false. */
export declare function categoryCanBeDisabled(category: string): boolean;

/** Whether the registry contains analytics or marketing, which need an explicit yes. */
export declare function hasOptionalTracking(registry?: readonly StorageEntry[]): boolean;

/** The rules of one zone. */
export interface ZonePolicy {
  readonly zone: ComplianceZone;
  /** The short one-line notice where the registry has nothing optional (§3). */
  readonly noticeWhenNecessaryOnly: boolean;
  /** Show the consent banner when an optional tracking category exists. */
  readonly consentBannerWhenOptional: boolean;
  /** In `none` optional tracking is off, because there is no mechanism to ask. */
  readonly optionalTrackingEnabled: boolean;
  /** Whether `navigator.globalPrivacyControl` counts as a no (§3). */
  readonly respectGlobalPrivacyControl: boolean;
  /** How long a choice lasts before it is asked again; null in `none`. */
  readonly choiceTtlDays: number | null;
  /** Whether a signed-in person's choice is written to `consent_events` (§4). */
  readonly logConsentForSignedIn: boolean;
  /**
   * Whether this zone can show `REMO_PERSONAL_DATA_CONSENT_URL`: the separate personal-data
   * consent document of the Russian installation (§3, §6). The link appears only when the
   * operator set the address, so the flag alone shows nothing.
   */
  readonly personalDataConsentLink: boolean;
}

/** The choices of a visitor, one boolean per category; `necessary` is always true. */
export type ConsentChoices = Readonly<Record<ConsentCategory, boolean>>;

export declare const ZONES: readonly ComplianceZone[];
export declare const ZONE_POLICY: Readonly<Record<ComplianceZone, ZonePolicy>>;

/** Whether a string is one of the zones the product understands. */
export declare function isComplianceZone(zone: string): zone is ComplianceZone;

/**
 * The zone of this deployment. Missing or blank means `none`; an unknown value throws, so a
 * typo cannot silently disable the rules of a zone.
 */
export declare function resolveConsentZone(
  env?: Readonly<Record<string, string | undefined>>,
): ComplianceZone;

/** The policy of a zone; an unknown zone throws. */
export declare function consentPolicy(zone: ComplianceZone): ZonePolicy;

/** The choice a first-time visitor starts with. */
export declare function defaultChoices(zone: ComplianceZone): ConsentChoices;

/**
 * A choice from the cookie or the banner, made safe for the zone: necessary stays on and
 * optional tracking stays off in `none`.
 */
export declare function normalizeChoices(
  zone: ComplianceZone,
  choices?: Partial<Record<ConsentCategory, boolean>>,
): ConsentChoices;

/** §3 row 1: the short notice, only where the registry has nothing optional. */
export declare function showConsentNotice(
  zone: ComplianceZone,
  registry?: readonly StorageEntry[],
): boolean;

/** §3 row 2: the banner, only where an optional tracking category exists. */
export declare function showConsentBanner(
  zone: ComplianceZone,
  registry?: readonly StorageEntry[],
): boolean;

/** Zone data invariants as text lines; empty means valid. */
export declare function validateZonePolicies(
  policies?: Readonly<Record<string, ZonePolicy>>,
): string[];

/** The first-party cookie that holds the choice (§4). */
export declare const CONSENT_COOKIE: "remo_consent";

/** The only value version the parser understands. */
export declare const CONSENT_COOKIE_VERSION: "v1";

/**
 * The optional categories the cookie may grant. `preferences` is necessary in both zones
 * and is not part of the choice.
 */
export declare const CONSENT_CHOICE_CATEGORIES: readonly ("analytics" | "marketing")[];

/** Whether a string can name a policy revision inside the cookie (no dots). */
export declare function isPolicyVersion(value: string): boolean;

/** How long a choice lives in this zone, in seconds, or `null` for `none`. */
export declare function consentCookieMaxAge(zone: ComplianceZone): number | null;

/** The expiry the API answers after setting a choice, or `null` for `none`. */
export declare function consentCookieExpiresAt(
  zone: ComplianceZone,
  now?: number,
): string | null;

/**
 * The cookie value `v1.<zone>.<policyVersion>.<choices>`; `choices` is `am`, `a`, `m` or
 * `-`. An unknown zone or a malformed policy revision throws.
 */
export declare function encodeConsentValue(input: {
  zone: ComplianceZone;
  policyVersion?: string;
  choices?: Partial<Record<ConsentCategory, boolean>>;
}): string;

/** A checked value, or `null` for missing, corrupt or foreign-zone input. */
export declare function parseConsentValue(raw: string): {
  readonly version: "v1";
  readonly zone: "eu" | "ru";
  readonly policyVersion: string;
  readonly choices: Readonly<Record<"analytics" | "marketing", boolean>>;
} | null;
