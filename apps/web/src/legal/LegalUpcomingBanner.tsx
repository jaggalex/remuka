/**
 * The 30-day banner before a revision takes effect (ADR-256 §5).
 *
 * It is announced, not enforced: a notice bar with the date and a link to the document,
 * closed for the rest of the browser session. The blocking window starts on the effective
 * day, so the two never ask at once. Every upcoming revision gets its own bar and its own
 * dismissal key.
 */
import { useEffect, useState } from "react";
import { Banner } from "@remo/ui";
import { useI18n } from "../i18n";
import { documentLabel, legalDate } from "./legalLabels";
import {
  legalUpcomingSessionKey,
  upcomingRevisions,
  type UpcomingDocument,
  type UpcomingInput,
} from "./legalUpcoming";

function UpcomingNotice({ upcoming }: { upcoming: UpcomingDocument<UpcomingInput> }) {
  const { t, lang } = useI18n();
  const key = legalUpcomingSessionKey(upcoming.document);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
      setDismissed(window.sessionStorage.getItem(key) === "1");
    } catch {
      // Private mode can refuse storage; the banner simply appears again.
      setDismissed(false);
    }
  }, [key]);

  if (dismissed) return null;
  const title = documentLabel(t, upcoming.document.doc);

  const close = () => {
    setDismissed(true);
    try {
      window.sessionStorage.setItem(key, "1");
    } catch {
      /* the dismissal still holds for this mount */
    }
  };

  return (
    <Banner
      tone="info"
      title={t("legal.upcoming.title", { doc: title })}
      onClose={close}
    >
      {t("legal.upcoming.body", {
        date: legalDate(upcoming.document.effective, lang),
      })}{" "}
      <a
        className="legal-consent-link"
        href={upcoming.document.url}
        target="_blank"
        rel="noopener noreferrer"
      >
        {t("legal.upcoming.link")}
      </a>
    </Banner>
  );
}

export function LegalUpcomingBanner({ documents }: { documents: readonly UpcomingInput[] }) {
  const upcoming = upcomingRevisions(documents);
  if (upcoming.length === 0) return null;
  return (
    <div className="legal-upcoming" role="region" aria-live="polite">
      {upcoming.map((item) => (
        <UpcomingNotice
          key={legalUpcomingSessionKey(item.document)}
          upcoming={item}
        />
      ))}
    </div>
  );
}
