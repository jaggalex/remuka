/** The registry of legal documents (ADR-256). Types for the plain-ESM module. */

export type LegalZone = "eu" | "ru";
export type LegalLang = "ru" | "en";
export type LegalRequired = "signup" | "none";
export type LegalStatus = "draft" | "published";

export interface LegalTitle {
  ru?: string;
  en?: string;
}

export interface LegalDocument {
  zone: LegalZone;
  doc: string;
  title: LegalTitle;
  current: number;
  status: LegalStatus;
  effective: string | null;
  required: LegalRequired;
  reaccept: boolean;
  /** A separate consent may be withdrawn (§6); absent means it cannot. */
  withdrawable?: boolean;
  lang: LegalLang[];
  /** Published revisions only: `<version>` → lowercase SHA-256 of the text. */
  sha256?: Record<string, string>;
  changes?: LegalTitle;
  changesHistory?: Record<string, LegalTitle & { sha256: string }>;
}

export interface LegalIndex {
  $comment?: string;
  documents: LegalDocument[];
}

export interface LegalRevisionFile {
  path: string;
  text: string;
  sha256: string;
}

export interface LegalRevisions {
  revisions: Map<number, Map<LegalLang, LegalRevisionFile>>;
  unexpected: string[];
}

export interface LegalPlaceholder {
  line: number;
  text: string;
}

export const LEGAL_ZONES: readonly LegalZone[];
export const LEGAL_LANGS: readonly LegalLang[];
export const LEGAL_REQUIRED: readonly LegalRequired[];
export const LEGAL_STATUSES: readonly LegalStatus[];
export const LEGAL_DOC_SLUG: RegExp;
export const LEGAL_HASH: RegExp;
export const LEGAL_CONTENT_DIR: string;
export const LEGAL_INDEX_FILE: string;

export function legalContentDir(root: string): string;
export function legalIndexPath(root: string): string;
export function legalDocumentDir(root: string, zone: string, doc: string): string;
export function legalDocumentPath(
  root: string,
  zone: string,
  doc: string,
  version: number,
  lang: string,
): string;
export function readLegalIndex(root: string): LegalIndex;
export function legalTextSha256(text: string): string;
export function readLegalText(
  root: string,
  entry: LegalDocument,
  version: number,
  lang: string,
): string;
export function readLegalRevisions(root: string, entry: LegalDocument): LegalRevisions;
export function legalDocuments(index: LegalIndex, zone: string): LegalDocument[];
export function legalDocument(index: LegalIndex, zone: string, doc: string): LegalDocument | null;
export function signupDocuments(index: LegalIndex, zone: string): LegalDocument[];
export function draftSignupDocuments(index: LegalIndex, zone: string): LegalDocument[];
export function recordedHash(entry: LegalDocument, version: number): string | null;
export function legalTitle(entry: LegalDocument, locale: string): string;
export function legalPagePath(doc: string, version?: number | null): string;
export function legalPageUrl(origin: string, doc: string, version?: number | null): string;
export function placeholderFindings(text: string): LegalPlaceholder[];
export function validateLegalIndex(index: LegalIndex): string[];
