/**
 * The signed-in legal journal, as the browser sees it (ADR-256 §4–§6).
 *
 * `GET /account/legal` answers the state of every document for this person, including
 * which revisions the blocking window must ask for. `POST /account/legal` accepts current
 * revisions; `POST /account/legal/withdraw` records a withdrawal the index allows.
 *
 * The acceptance body names the revision and its hash, so the server can refuse a stale
 * form with `LEGAL_VERSION_CHANGED` instead of recording a text the person never saw.
 */
import { call } from "../apiCall";
import type { LegalDocumentConfig } from "./legalConfig";

export interface LegalDocumentState extends LegalDocumentConfig {
  readonly accepted: boolean;
  readonly acceptedAt: string | null;
  readonly acceptedVersion: number | null;
  readonly withdrawnAt: string | null;
  /** The blocking window asks for this document. */
  readonly pending: boolean;
}

export interface AccountLegal {
  readonly zone: string;
  readonly documents: LegalDocumentState[];
  /** Documents with `reaccept: true` whose current revision is not accepted. */
  readonly pending: string[];
}

export interface LegalAcceptanceInput {
  readonly doc: string;
  readonly version: number;
  readonly sha256: string;
}

/** The signed-in journal: this installation's documents and this person's state. */
export function loadAccountLegal(): Promise<AccountLegal> {
  return call<AccountLegal>("/account/legal");
}

export function acceptAccountLegal(
  acceptances: readonly LegalAcceptanceInput[],
): Promise<AccountLegal> {
  return call<AccountLegal>("/account/legal", {
    method: "POST",
    body: { acceptances },
  });
}

export function withdrawAccountLegal(
  doc: string,
): Promise<AccountLegal & { changed: boolean }> {
  return call<AccountLegal & { changed: boolean }>("/account/legal/withdraw", {
    method: "POST",
    body: { doc },
  });
}

/** A document whose current revision can be accepted from the account screen. */
export function canAccept(document: LegalDocumentState): boolean {
  return (document.required === "signup" || document.pending) && !document.accepted;
}
