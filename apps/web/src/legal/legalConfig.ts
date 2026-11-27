/**
 * The `legal` field of `GET /config`: the documents of this installation's zone
 * (ADR-256 §4).
 *
 * The server owns the registry; the browser only turns an untrusted JSON field into a
 * shape a form and a page can read. Anything malformed is dropped, never rendered: a
 * checkbox must never name a document the server will not check, and a link must never
 * become a `javascript:` address. A missing field is the safe `none` zone — no documents.
 */

export type LegalRequired = "signup" | "none";
export type LegalStatus = "draft" | "published";

export interface LegalDocumentConfig {
  readonly doc: string;
  readonly changes?: Partial<Record<"ru" | "en", string>>;
  readonly zone: string;
  readonly version: number;
  readonly sha256: string;
  /** `YYYY-MM-DD` when the revision takes effect; null while a draft has no date. */
  readonly effective: string | null;
  readonly required: LegalRequired;
  readonly reaccept: boolean;
  readonly status: LegalStatus;
  /** A separate consent may be withdrawn (§6); the index decides, not the screen. */
  readonly withdrawable: boolean;
  /** The public page of the current revision on this installation's site. */
  readonly url: string;
}

const DOC = /^[a-z][a-z0-9-]*$/;
const SHA256 = /^[a-f0-9]{64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function httpUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

function documentOf(value: unknown): LegalDocumentConfig | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.doc !== "string" || !DOC.test(raw.doc)) return null;
  if (typeof raw.zone !== "string" || !raw.zone) return null;
  if (!Number.isInteger(raw.version) || (raw.version as number) < 1) return null;
  if (typeof raw.sha256 !== "string" || !SHA256.test(raw.sha256)) return null;
  if (raw.required !== "signup" && raw.required !== "none") return null;
  if (raw.status !== "draft" && raw.status !== "published") return null;
  if (typeof raw.reaccept !== "boolean") return null;
  const url = httpUrl(raw.url);
  if (!url) return null;
  const effective =
    typeof raw.effective === "string" && DATE.test(raw.effective) ? raw.effective : null;
  const changes: Partial<Record<"ru" | "en", string>> = {};
  if (raw.changes && typeof raw.changes === "object") {
    for (const lang of ["ru", "en"] as const) {
      const text = (raw.changes as Record<string, unknown>)[lang];
      if (typeof text === "string" && text.trim()) changes[lang] = text;
    }
  }
  return {
    ...(changes.ru || changes.en ? { changes } : {}),
    doc: raw.doc,
    zone: raw.zone,
    version: raw.version as number,
    sha256: raw.sha256,
    effective,
    required: raw.required,
    reaccept: raw.reaccept,
    status: raw.status,
    withdrawable: raw.withdrawable === true,
    url,
  };
}

/** The documents of this zone, malformed entries dropped. */
export function readLegalConfig(value: unknown): LegalDocumentConfig[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const documents = (value as { documents?: unknown }).documents;
  if (!Array.isArray(documents)) return [];
  const seen = new Set<string>();
  const result: LegalDocumentConfig[] = [];
  for (const item of documents) {
    const document = documentOf(item);
    if (!document || seen.has(document.doc)) continue;
    seen.add(document.doc);
    result.push(document);
  }
  return result;
}

/**
 * The offer a payer accepts: the installation's own document first.
 *
 * The zone names it differently — `offer` in the Russian installation, `terms` in the
 * European one — so the screen asks for either and never builds the address from the
 * guide. The guide is only the fallback for an installation that publishes no offer yet.
 */
export function offerDocumentUrl(
  documents: readonly LegalDocumentConfig[],
): string | null {
  const offer = documents.find((document) => document.doc === "offer" || document.doc === "terms");
  return offer?.url ?? null;
}

/** The documents the registration form must show as checkboxes (§2, §3). */
export function signupLegalDocuments(
  documents: readonly LegalDocumentConfig[],
): LegalDocumentConfig[] {
  return documents.filter((document) => document.required === "signup");
}
