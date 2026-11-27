import { useI18n } from "../i18n";
import type { LegalDocumentConfig } from "./legalConfig";
import { documentLabel } from "./legalLabels";

export function LegalChanges({ document }: { document: LegalDocumentConfig }) {
  const { lang, t } = useI18n();
  const changes = document.changes;
  const locale = changes?.[lang] ? lang : changes?.ru ? "ru" : "en";
  const summary = changes?.[locale];
  if (!summary) return null;
  return (
    <p className="legal-changes">
      <strong>{t("legal.changes", { document: documentLabel(t, document.doc) })}</strong>{" "}
      <span lang={locale}>{summary}</span>
    </p>
  );
}
