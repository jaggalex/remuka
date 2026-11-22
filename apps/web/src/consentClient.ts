/**
 * What the browser knows about the cookie choice, as pure data (ADR-255,
 * `spec/cookies.md` §§3–6).
 *
 * The registry and the zone rules live in `@remo/consent`; this module only turns them
 * into the three questions a component asks: which surface to show, whether a category
 * may run, and what the settings screen lists. Keeping it free of React is what lets the
 * zone matrix be tested without a browser.
 *
 * The choice itself is the server's: `GET /consent` reads `remo_consent`, `POST /consent`
 * writes it. Nothing here touches `localStorage` or `sessionStorage` — the choice must
 * survive the browser session, and a second copy of it is exactly the second mechanism
 * ADR-255 §1 rule 1 forbids.
 */
import {
  CATEGORIES,
  POLICY_VERSION,
  STORAGE_REGISTRY,
  consentPolicy,
  normalizeChoices,
  showConsentBanner,
  showConsentNotice,
} from "@remo/consent";
import type { ConsentCategory, StorageEntry } from "@remo/consent";
import { ApiError, call } from "./apiCall";
import type { ComplianceZone } from "./compliance";

/** One boolean per category; `necessary` is always true after normalization. */
export type ConsentChoices = Readonly<Record<ConsentCategory, boolean>>;

/** The answer of `GET /consent` after `readConsentAnswer` has checked it. */
export interface ConsentAnswer {
  readonly zone: "eu" | "ru";
  readonly choices: ConsentChoices;
  readonly policyVersion: string;
}

/** Everything a surface or the gate reads. */
export interface ConsentView {
  readonly zone: ComplianceZone;
  /** Whether the server holds a choice for this browser. */
  readonly answered: boolean;
  readonly choices: ConsentChoices;
  /** `navigator.globalPrivacyControl`, §3. */
  readonly gpc: boolean;
}

/** Which of the three §6 surfaces belongs on screen. */
export type ConsentSurface = "none" | "notice" | "banner";

/**
 * Global Privacy Control is a refusal, not a hint (§3).
 *
 * Read defensively: an old browser has no property at all, and only the boolean `true`
 * counts. A string or a number is not a signal the specification defines.
 */
export function globalPrivacyControl(nav: unknown): boolean {
  return (
    typeof nav === "object" &&
    nav !== null &&
    (nav as { globalPrivacyControl?: unknown }).globalPrivacyControl === true
  );
}

/** The choice a browser starts with when the server has no answer. */
export function unansweredChoices(zone: ComplianceZone): ConsentChoices {
  return normalizeChoices(zone === "none" ? "none" : zone);
}

/**
 * The surface for a zone: the §3 matrix in one place.
 *
 * - `none`: nothing at all.
 * - a choice already made: nothing, the footer link remains.
 * - tracking in the registry and no choice: the banner; with GPC the refusal is already
 *   expressed, so no banner is needed and optional scripts stay off (they are gated by
 *   `categoryAllowed`, not by the banner's absence).
 * - only necessary storage: the short notice in `ru`, nothing in `eu`.
 */
export function consentSurface(
  view: Pick<ConsentView, "zone" | "answered" | "gpc">,
  registry: readonly StorageEntry[] = STORAGE_REGISTRY,
): ConsentSurface {
  if (view.zone === "none" || view.answered) return "none";
  if (showConsentBanner(view.zone, registry)) {
    const policy = consentPolicy(view.zone);
    if (view.gpc && policy.respectGlobalPrivacyControl) return "none";
    return "banner";
  }
  return showConsentNotice(view.zone, registry) ? "notice" : "none";
}

/**
 * Whether a category may run now (§1 rule 2, §5).
 *
 * `analytics` and `marketing` need an explicit `true` in the stored choice: an unanswered
 * browser, the `none` zone and GPC all mean no. `necessary` and `preferences` are storage the
 * requested service needs (§2), so they are allowed in every zone and are never a question.
 */
export function categoryAllowed(
  view: Pick<ConsentView, "zone" | "choices" | "gpc">,
  category: ConsentCategory,
): boolean {
  if (category === "necessary" || category === "preferences") return true;
  if (view.zone === "none") return false;
  const policy = consentPolicy(view.zone);
  const choices = normalizeChoices(view.zone, view.choices);
  if (category === "analytics" || category === "marketing") {
    if (!policy.optionalTrackingEnabled) return false;
    if (view.gpc && policy.respectGlobalPrivacyControl) return false;
    return choices[category] === true;
  }
  return false;
}

/** What the banner's two one-click buttons save: both tracking categories, together. */
export function bulkChoices(granted: boolean): Partial<Record<ConsentCategory, boolean>> {
  return { analytics: granted, marketing: granted };
}

/**
 * The payload `POST /consent` accepts: only the two tracking categories the service records
 * (§4). `necessary` and `preferences` are not a question, so they are never sent — a request
 * that carried them would claim a consent the person was not asked for.
 */
function payloadChoices(choices: Partial<Record<ConsentCategory, boolean>>): Record<string, boolean> {
  return { analytics: choices.analytics === true, marketing: choices.marketing === true };
}

/**
 * `POST /consent` refused the policy edition this bundle knows (§4, §11 question (в)).
 *
 * The server keeps only choices made under the current text, so the client re-reads
 * `/consent` and asks again instead of pretending the choice was stored.
 */
export class ConsentOutdatedError extends Error {
  constructor(readonly current: string | null) {
    super("the cookie policy changed");
    this.name = "ConsentOutdatedError";
  }
}

/** Whether a transport failure is the stricter policy edition of `consent-api.mjs`. */
function isPolicyOutdated(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 409 && error.code === "POLICY_OUTDATED";
}

/** `GET /consent`'s body, checked: a foreign zone or a malformed body is no answer. */
export function readConsentAnswer(value: unknown, zone: ComplianceZone): ConsentAnswer | null {
  if (zone === "none" || !value || typeof value !== "object") return null;
  const body = value as { zone?: unknown; choices?: unknown; policyVersion?: unknown };
  if (body.zone !== zone) return null;
  if (typeof body.policyVersion !== "string" || !body.policyVersion) return null;
  const choices = readChoices(body.choices);
  return choices ? { zone, choices: normalizeChoices(zone, choices), policyVersion: body.policyVersion } : null;
}

/** The choices of an answer body, or null when the field is not an object. */
function readChoices(raw: unknown): Partial<Record<ConsentCategory, boolean>> | null {
  if (!raw || typeof raw !== "object") return null;
  const choices: Partial<Record<ConsentCategory, boolean>> = {};
  for (const category of CATEGORIES) {
    const value = (raw as Record<string, unknown>)[category];
    if (typeof value === "boolean") choices[category] = value;
  }
  return choices;
}

/**
 * `POST /consent`'s body, checked.
 *
 * The service answers the edition it stored along with the effective choices and the
 * expiry (`consent-api.mjs`), so the answer names its policy. A body from a service that
 * predates the field is read under the edition of the request. A zone other than this
 * installation's is a refusal, not an answer.
 */
export function readSavedAnswer(
  value: unknown,
  zone: ComplianceZone,
  policyVersion: string = POLICY_VERSION,
): ConsentAnswer | null {
  if (zone === "none" || !value || typeof value !== "object") return null;
  const body = value as { zone?: unknown; choices?: unknown; policyVersion?: unknown };
  if (body.zone !== zone) return null;
  const choices = readChoices(body.choices);
  if (!choices) return null;
  const stored =
    typeof body.policyVersion === "string" && body.policyVersion
      ? body.policyVersion
      : policyVersion;
  return { zone, choices: normalizeChoices(zone, choices), policyVersion: stored };
}

/** The transport is injectable so a unit test proves the request without a server. */
export type ConsentTransport = (payload: Record<string, unknown>) => Promise<unknown>;

const post: ConsentTransport = (body) => call("/consent", { method: "POST", body });

/**
 * Read the server's answer. A missing cookie is `null`, not an error: it is the state of
 * a browser that has not decided yet.
 */
export async function loadConsent(
  zone: ComplianceZone,
  get: () => Promise<unknown> = () => call("/consent"),
): Promise<ConsentAnswer | null> {
  if (zone === "none") return null;
  return readConsentAnswer(await get(), zone);
}

/**
 * Save a choice and return what the server stored.
 *
 * The policy edition travels with the request so the journal records which text the person
 * agreed to (§4). The service accepts only the current edition and answers
 * `409 POLICY_OUTDATED` for an older one, which becomes a `ConsentOutdatedError`: the
 * caller re-reads `/consent` and asks for a confirmation under the new text. Any other
 * refusal throws too — showing the banner as if the choice had been kept would be a lie.
 */
export async function saveConsent(
  zone: ComplianceZone,
  choices: Partial<Record<ConsentCategory, boolean>>,
  transport: ConsentTransport = post,
): Promise<ConsentAnswer | null> {
  if (zone === "none") return null;
  let raw: unknown;
  try {
    raw = await transport({ zone, policyVersion: POLICY_VERSION, choices: payloadChoices(choices) });
  } catch (error) {
    if (isPolicyOutdated(error)) {
      const current =
        typeof error.details.current === "string" ? error.details.current : null;
      throw new ConsentOutdatedError(current);
    }
    throw error;
  }
  const answer = readSavedAnswer(raw, zone);
  if (!answer) throw new Error("the service did not confirm the consent choice");
  return answer;
}

/** One category row of the settings screen (§6.2). */
export interface ConsentCategoryRow {
  readonly category: ConsentCategory;
  readonly entries: readonly StorageEntry[];
  readonly enabled: boolean;
  /** A switch the person cannot move: necessary, preferences, the `none` zone or GPC. */
  readonly locked: boolean;
  /** Why it is locked, for the one hint under the row. */
  readonly lock: "necessary" | "gpc" | "policy" | null;
}

/**
 * The settings rows, one per category the registry actually contains.
 *
 * A category that no record uses is not shown: a switch that governs nothing is the
 * second mechanism in miniature. `necessary` and `preferences` are on and locked — the
 * second is the person's own language and theme, which are necessary storage in every zone
 * (§2, §6) — so the screen states them without offering a switch.
 */
export function categoryRows(
  view: Pick<ConsentView, "zone" | "choices" | "gpc">,
  registry: readonly StorageEntry[] = STORAGE_REGISTRY,
): ConsentCategoryRow[] {
  const policy = consentPolicy(view.zone);
  const choices = normalizeChoices(view.zone === "none" ? "none" : view.zone, view.choices);
  const gpc = view.gpc && policy.respectGlobalPrivacyControl;
  const rows: ConsentCategoryRow[] = [];
  for (const category of CATEGORIES) {
    const entries = registry.filter((entry) => entry.category === category);
    if (entries.length === 0) continue;
    if (category === "necessary" || category === "preferences") {
      rows.push({ category, entries, enabled: true, locked: true, lock: "necessary" });
      continue;
    }
    const blocked = gpc || !policy.optionalTrackingEnabled;
    rows.push({
      category,
      entries,
      enabled: blocked ? false : choices[category] === true,
      locked: blocked,
      lock: gpc ? "gpc" : blocked ? "policy" : null,
    });
  }
  return rows;
}

/**
 * The registry as the policy page lists it: grouped by category in the registry's order,
 * then by name. No row is written by hand (§6.4).
 */
export function policyRows(registry: readonly StorageEntry[] = STORAGE_REGISTRY): StorageEntry[] {
  const order = new Map(CATEGORIES.map((category, index) => [category, index]));
  return [...registry].sort((left, right) => {
    const byCategory = (order.get(left.category) ?? 0) - (order.get(right.category) ?? 0);
    return byCategory !== 0 ? byCategory : left.name.localeCompare(right.name);
  });
}

/** Whether the installation has anything optional at all (§6.2). */
export function hasTracking(registry: readonly StorageEntry[] = STORAGE_REGISTRY): boolean {
  return registry.some((entry) => entry.category === "analytics" || entry.category === "marketing");
}
