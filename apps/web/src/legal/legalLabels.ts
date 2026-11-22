/**
 * The words for a document and a date in the interface language (ADR-256 §7).
 *
 * A document id is a path segment, not a name: the registry carries titles for its own
 * pages, while the product names the documents it knows. An unknown document — an
 * operator's own — falls back to its id, which is at least honest and never empty.
 */
import type { TranslationKey } from "../i18n";
import type { Lang } from "../i18n";

const DOC_KEYS: Record<string, TranslationKey> = {
  offer: "legal.doc.offer",
  consent: "legal.doc.consent",
  privacy: "legal.doc.privacy",
  cookies: "legal.doc.cookies",
  rules: "legal.doc.rules",
  terms: "legal.doc.terms",
  dpa: "legal.doc.dpa",
};

export function documentLabel(
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string,
  doc: string,
): string {
  const key = DOC_KEYS[doc];
  return key ? t(key) : doc;
}

/** The same date the server prints in a letter: long, in the reader's language. */
export function legalDate(value: string | null | undefined, lang: Lang): string {
  if (!value) return "";
  const parsed = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(lang === "ru" ? "ru-RU" : "en-US", {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(parsed);
}
