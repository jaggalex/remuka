/**
 * `?legal=documents`: every document of this installation, the revision in force and
 * what the signed-in person has accepted (ADR-256 §6–§7).
 *
 * The list is the server's registry (`GET /config.legal`); the acceptance state comes from
 * `GET /account/legal`. A guest sees the same documents without status and without a
 * button — accepting is an account action, never something a public page can do.
 *
 * Withdrawal is offered only where the index says `withdrawable: true`: a document that
 * rests on a contract has no separate consent to take back. The confirmation explains the
 * consequence and opens the existing account-deletion dialog, because withdrawing does
 * not delete anything by itself.
 */
import { LegalChanges } from "./LegalChanges";
import { useState } from "react";
import { Button, Dialog, Link } from "@remo/ui";
import { useI18n } from "../i18n";
import { AccountDeletionDialog } from "../AccountDeletion";
import { HelpLink } from "../help/HelpLink";
import { canAccept, type LegalDocumentState } from "./accountLegal";
import { documentLabel, legalDate } from "./legalLabels";
import type { LegalDocumentConfig } from "./legalConfig";
import { useLegalAccount } from "./LegalProvider";

function Meta({ document: doc }: { document: LegalDocumentConfig }) {
  const { t, lang } = useI18n();
  return (
    <p className="legal-doc-meta">
      <span>{t("legal.page.current", { version: doc.version })}</span>
      {doc.effective && (
        <span>{t("legal.page.effective", { date: legalDate(doc.effective, lang) })}</span>
      )}
      {doc.required === "signup" && <span>{t("legal.page.required")}</span>}
      {doc.status === "draft" && (
        <span className="legal-draft">{t("legal.page.draft")}</span>
      )}
    </p>
  );
}

function Archive({ document: doc }: { document: LegalDocumentConfig }) {
  const { t } = useI18n();
  if (doc.version <= 1) return null;
  return (
    <p className="legal-doc-archive">
      <span>{t("legal.page.archive")}:</span>
      {Array.from({ length: doc.version }, (_, index) => index + 1).map((version) => (
        <a
          key={version}
          className="legal-doc-archive-link"
          href={`${doc.url}/v${version}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t("legal.page.version", { version })}
        </a>
      ))}
    </p>
  );
}

function Status({ document: doc }: { document: LegalDocumentState }) {
  const { t, lang } = useI18n();
  if (doc.withdrawnAt) {
    return (
      <p className="legal-doc-status is-missing">
        {t("legal.page.withdrawn", { date: legalDate(doc.withdrawnAt, lang) })}
      </p>
    );
  }
  return doc.accepted ? (
    <p className="legal-doc-status is-accepted">
      {t("legal.page.accepted", { date: legalDate(doc.acceptedAt, lang) })}
    </p>
  ) : (
    <p className="legal-doc-status is-missing">{t("legal.page.notAccepted")}</p>
  );
}

export function LegalDocumentsPage({ inline = false }: { inline?: boolean }) {
  const Container = inline ? "section" : "main";
  const { t, legal } = useI18n();
  const { account, ready, busy, error, accept, withdraw } = useLegalAccount();
  const [confirm, setConfirm] = useState<string | null>(null);
  const [deletionOpen, setDeletionOpen] = useState(false);
  const [withdrawn, setWithdrawn] = useState(false);

  const documents: readonly LegalDocumentState[] =
    account?.documents ??
    legal.map((document) => ({
      ...document,
      accepted: false,
      acceptedAt: null,
      acceptedVersion: null,
      withdrawnAt: null,
      pending: false,
    }));
  const isGuest = account === null;

  const confirmDocument = confirm
    ? documents.find((document) => document.doc === confirm) ?? null
    : null;

  return (
    <div className={inline ? "account-documents" : "legal-page"}>
      {!inline && <header className="legal-page-topbar">
        <a className="legal-page-home" href="/">
          {t("legal.page.back")}
        </a>
      </header>}
      <Container className={inline ? undefined : "legal-page-main"}>
        <div className="legal-page-heading">
          {!inline && <h1>{t("legal.page.title")}</h1>}
          <HelpLink topicId="account.documents" />
        </div>
        <p className="legal-page-intro">{t("legal.page.intro")}</p>
        {isGuest && ready && documents.length > 0 && (
          <p className="legal-page-note">{t("legal.page.guest")}</p>
        )}
        {error && documents.length > 0 && <p className="auth-error">{error}</p>}

        {!ready ? (
          <p className="legal-page-state">{t("legal.page.loading")}</p>
        ) : error && documents.length === 0 ? (
          <p className="legal-page-state">{t("legal.page.failed")}</p>
        ) : documents.length === 0 ? (
          <p className="legal-page-state">{t("legal.page.empty")}</p>
        ) : (
          <ul className="legal-doc-list">
            {documents.map((document) => (
              <li className="legal-doc" key={document.doc}>
                <LegalChanges document={document} />
                <div className="legal-doc-head">
                  <h2 className="legal-doc-title">
                    <a href={document.url} target="_blank" rel="noopener noreferrer">
                      {documentLabel(t, document.doc)}
                    </a>
                  </h2>
                  {!isGuest && <Status document={document} />}
                </div>
                <Meta document={document} />
                {document.status === "draft" && (
                  <p className="legal-page-note">{t("legal.page.draftNote")}</p>
                )}
                <Archive document={document} />
                {!isGuest && (
                  <div className="legal-doc-actions">
                    {canAccept(document) && (
                      <Button
                        size="compact"
                        variant="primary"
                        loading={busy}
                        onClick={() =>
                          void accept([
                            {
                              doc: document.doc,
                              version: document.version,
                              sha256: document.sha256,
                            },
                          ])
                        }
                      >
                        {t("legal.page.accept")}
                      </Button>
                    )}
                    {document.withdrawable && document.accepted && (
                      <Button
                        size="compact"
                        variant="secondary"
                        onClick={() => {
                          setWithdrawn(false);
                          setConfirm(document.doc);
                        }}
                      >
                        {t("legal.page.withdraw")}
                      </Button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {!isGuest && withdrawn && (
          <section className="legal-page-consequence" aria-live="polite">
            <p>{t("legal.withdraw.done")}</p>
            <p className="legal-page-note">{t("legal.withdraw.body")}</p>
            <Button variant="danger" onClick={() => setDeletionOpen(true)}>
              {t("legal.withdraw.delete")}
            </Button>
          </section>
        )}
      </Container>

      {confirmDocument && (
        <Dialog
          title={t("legal.withdraw.title")}
          size="sm"
          onClose={() => setConfirm(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirm(null)}>
                {t("legal.withdraw.cancel")}
              </Button>
              <Button
                variant="danger"
                loading={busy}
                onClick={() => {
                  void withdraw(confirmDocument.doc).then((saved) => {
                    if (!saved) return;
                    setConfirm(null);
                    setWithdrawn(true);
                  });
                }}
              >
                {t("legal.withdraw.confirm")}
              </Button>
            </>
          }
        >
          <p>{t("legal.withdraw.body")}</p>
          {error && <p className="auth-error">{error}</p>}
          <p className="legal-page-note">
            <Link href={confirmDocument.url} target="_blank" rel="noreferrer">
              {documentLabel(t, confirmDocument.doc)}
            </Link>
          </p>
        </Dialog>
      )}

      <AccountDeletionDialog
        open={deletionOpen}
        onClose={() => setDeletionOpen(false)}
        onScheduled={() => window.location.assign("/")}
        onCancelled={() => setDeletionOpen(false)}
      />
    </div>
  );
}
