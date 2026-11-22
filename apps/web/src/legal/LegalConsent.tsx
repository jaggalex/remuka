/**
 * The checkboxes of the registration form, and the same list in the re-acceptance window
 * (ADR-256 §3, §7).
 *
 * The component shows only what the server says is required at sign-up: the list comes
 * from `GET /config.legal`, and the server checks the same list again on submit. A box
 * starts empty and is an active action; the consent to personal-data processing is a
 * separate box from the offer, never bundled into one.
 *
 * Links open the document of this installation in a new tab. They sit inside the label so
 * the sentence reads as one line; a click on a link is stopped from toggling the box,
 * because reading a document is not accepting it.
 */
import { Checkbox } from "@remo/ui";
import { documentLabel } from "./legalLabels";
import type { LegalDocumentConfig } from "./legalConfig";
import { useI18n, type TranslationKey } from "../i18n";

type Translate = (key: TranslationKey, vars?: Record<string, string | number>) => string;

function DocumentLink({
  document,
  label,
}: {
  document: LegalDocumentConfig;
  label: string;
}) {
  return (
    <a
      className="legal-consent-link"
      href={document.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(event) => event.stopPropagation()}
    >
      {label}
    </a>
  );
}

/** The one sentence of a checkbox, with the documents it names as links. */
function consentSentence(
  t: Translate,
  document: LegalDocumentConfig,
  privacy: LegalDocumentConfig | null,
) {
  const title = documentLabel(t, document.doc);
  if (document.doc === "offer") {
    return (
      <>
        {t("legal.consent.offerBefore")}
        <DocumentLink document={document} label={t("legal.consent.offerLink")} />
        {t("legal.consent.offerAfter")}
      </>
    );
  }
  if (document.doc === "consent") {
    return (
      <>
        {t("legal.consent.consentBefore")}
        <DocumentLink document={document} label={t("legal.consent.consentLink")} />
        {t("legal.consent.consentMiddle")}
        {privacy ? (
          <DocumentLink document={privacy} label={t("legal.consent.privacyLink")} />
        ) : (
          t("legal.consent.privacyLink")
        )}
        {t("legal.consent.consentAfter")}
      </>
    );
  }
  if (document.doc === "terms") {
    return (
      <>
        {t("legal.consent.termsBefore")}
        <DocumentLink document={document} label={t("legal.consent.termsLink")} />
        {t("legal.consent.termsMiddle")}
        {privacy ? (
          <DocumentLink document={privacy} label={t("legal.consent.privacyLink")} />
        ) : (
          t("legal.consent.privacyLink")
        )}
        {t("legal.consent.termsAfter")}
      </>
    );
  }
  return (
    <>
      {t("legal.consent.genericBefore")}
      <DocumentLink document={document} label={title} />
      {t("legal.consent.genericAfter")}
    </>
  );
}

export function LegalConsentView({
  documents,
  all,
  checked,
  onChange,
  error,
  idPrefix = "legal-consent",
  t,
}: {
  /** The documents the registration form must ask for (`required: signup`). */
  documents: readonly LegalDocumentConfig[];
  /** Every document of the zone, so the consent sentence can link the policy. */
  all: readonly LegalDocumentConfig[];
  checked: Readonly<Record<string, boolean>>;
  onChange: (doc: string, value: boolean) => void;
  /** A refusal from the server, shown above the list. */
  error?: string | null;
  idPrefix?: string;
  t: Translate;
}) {
  const privacy = all.find((document) => document.doc === "privacy") ?? null;

  if (documents.length === 0) {
    // A self-host installation with no documents has no checkbox, and the server requires
    // none: an empty plate would be a promise the installation cannot keep.
    return null;
  }

  return (
    <div className="legal-consent" role="group" aria-label={t("legal.consent.group")}>
      {documents.map((document) => {
        const id = `${idPrefix}-${document.doc}`;
        const isChecked = Boolean(checked[document.doc]);
        return (
          <div className="legal-consent-row" key={document.doc}>
            <Checkbox
              id={id}
              name={document.doc}
              checked={isChecked}
              hint={isChecked ? undefined : t("legal.consent.requiredHint")}
              aria-invalid={error ? true : undefined}
              onChange={(event) => onChange(document.doc, event.currentTarget.checked)}
              label={
                <>
                  {consentSentence(t, document, privacy)}
                  {document.status === "draft" && (
                    <span className="legal-draft">{t("legal.consent.draft")}</span>
                  )}
                </>
              }
            />
          </div>
        );
      })}
      {error && <p className="auth-error legal-consent-error">{error}</p>}
    </div>
  );
}

export function LegalConsent(props: Omit<Parameters<typeof LegalConsentView>[0], "t">) {
  const { t } = useI18n();
  return <LegalConsentView {...props} t={t} />;
}
