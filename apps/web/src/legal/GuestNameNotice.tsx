/**
 * The line beside a guest's name: the name is visible to the room, and the documents
 * explain the rest (ADR-256 §6).
 *
 * Shown only when the installation has a compliance zone. A `none` self-host makes no
 * promise about a policy it does not publish, so the line would be an empty claim.
 */
import { useI18n } from "../i18n";

export function GuestNameNotice() {
  const { t, compliance } = useI18n();
  if (compliance.zone === "none") return null;
  return (
    <p className="auth-hint legal-guest-name">
      {t("legal.guest.nameBefore")}
      <a className="legal-consent-link" href="/?legal=documents">
        {t("legal.guest.nameLink")}
      </a>
      {t("legal.guest.nameAfter")}
    </p>
  );
}
