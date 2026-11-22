/**
 * The notice and the banner of the cookie module (§6.1, §6.2 of `spec/cookies.md`).
 *
 * Both are the same bottom plate, not a modal: they never cover the canvas tool rail and
 * they never block work. The two presentational cards take their words as props, so the
 * zone matrix and the markup can be tested without a browser; the exported `ConsentNotice`
 * and `ConsentBanner` are the containers that read the product's i18n.
 *
 * Escape acknowledges the notice — the notice is information, and a person who presses
 * Escape has read it. Escape never accepts the banner: a refusal is a decision, and a key
 * press must not stand in for it (§1 rule 2).
 */
import { useEffect, useId, useRef, type ReactNode } from "react";
import { Button } from "@remo/ui";
import { useI18n } from "./i18n";

interface NoticeCardProps {
  text: string;
  learnLabel: string;
  actionLabel: string;
  policyHref: string;
  /** The separate personal-data consent document of the `ru` zone, when the operator set it. */
  personalDataHref?: string | null;
  personalDataLabel?: string;
  onAction: () => void;
}

/**
 * The `ru` notice: one sentence, «Подробнее», «Понятно».
 *
 * The first control takes focus so a keyboard user can answer without hunting for the
 * plate (the spec asks for focus on the first button). It is not modal: the rest of
 * the screen stays usable.
 */
export function ConsentNoticeCard({
  text,
  learnLabel,
  actionLabel,
  policyHref,
  personalDataHref = null,
  personalDataLabel = "",
  onAction,
}: NoticeCardProps) {
  const label = useId();
  const box = useRef<HTMLElement>(null);
  useEffect(() => {
    box.current?.querySelector<HTMLElement>("button")?.focus();
  }, []);
  return (
    <section
      ref={box}
      className="consent-notice"
      role="dialog"
      aria-labelledby={label}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onAction();
        }
      }}
    >
      <p className="consent-notice-text" id={label}>
        {text}{" "}
        <a className="consent-notice-link" href={policyHref}>
          {learnLabel}
        </a>
        {/* §6.1, §3: the Russian installation links its personal-data consent document
            only when `REMO_PERSONAL_DATA_CONSENT_URL` names one. */}
        {personalDataHref && (
          <>
            {" "}
            <a className="consent-notice-link" href={personalDataHref} rel="noreferrer">
              {personalDataLabel}
            </a>
          </>
        )}
      </p>
      <Button size="compact" variant="secondary" onClick={onAction}>
        {actionLabel}
      </Button>
    </section>
  );
}

interface BannerCardProps {
  text: string;
  acceptLabel: string;
  rejectLabel: string;
  customizeLabel: string;
  onAccept: () => void;
  onReject: () => void;
  onCustomize: () => void;
}

/**
 * The banner for a registry with analytics or marketing (§6.2, §1 rule 3).
 *
 * «Принять всё» and «Отклонить всё» carry the same weight; «Настроить» is the quiet third
 * choice. No checkbox is pre-ticked and nothing is loaded by closing the banner, because
 * closing is not offered at all.
 */
export function ConsentBannerCard({
  text,
  acceptLabel,
  rejectLabel,
  customizeLabel,
  onAccept,
  onReject,
  onCustomize,
}: BannerCardProps) {
  const label = useId();
  const box = useRef<HTMLElement>(null);
  useEffect(() => {
    box.current?.querySelector<HTMLElement>("button")?.focus();
  }, []);
  return (
    <section ref={box} className="consent-banner" role="dialog" aria-labelledby={label}>
      <p className="consent-banner-text" id={label}>
        {text}
      </p>
      <div className="consent-banner-actions">
        <Button size="compact" variant="secondary" onClick={onAccept}>
          {acceptLabel}
        </Button>
        <Button size="compact" variant="secondary" onClick={onReject}>
          {rejectLabel}
        </Button>
        <Button size="compact" variant="ghost" onClick={onCustomize}>
          {customizeLabel}
        </Button>
      </div>
    </section>
  );
}

/** The container used by the provider; the words come from the product's tables. */
export function ConsentNotice({
  onAcknowledge,
  policyHref,
  personalDataHref = null,
}: {
  onAcknowledge: () => void;
  policyHref: string;
  personalDataHref?: string | null;
}): ReactNode {
  const { t } = useI18n();
  return (
    <ConsentNoticeCard
      text={t("consent.notice")}
      learnLabel={t("consent.notice.learn")}
      actionLabel={t("consent.notice.gotIt")}
      policyHref={policyHref}
      personalDataHref={personalDataHref}
      personalDataLabel={t("consent.notice.personalData")}
      onAction={onAcknowledge}
    />
  );
}

/** The banner container; `grant(false)` is the refusal, not a dismissal. */
export function ConsentBanner({
  onAccept,
  onReject,
  onCustomize,
}: {
  onAccept: () => void;
  onReject: () => void;
  onCustomize: () => void;
}): ReactNode {
  const { t } = useI18n();
  return (
    <ConsentBannerCard
      text={t("consent.banner.text")}
      acceptLabel={t("consent.banner.acceptAll")}
      rejectLabel={t("consent.banner.rejectAll")}
      customizeLabel={t("consent.banner.customize")}
      onAccept={onAccept}
      onReject={onReject}
      onCustomize={onCustomize}
    />
  );
}
