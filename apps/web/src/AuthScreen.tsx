import { useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { BrandMark } from "@remo/ui";
import { brandName } from "@remo/brand";
import { useI18n, type TranslationKey } from "./i18n";

const notes = {
  login: "access.noteLogin",
  code: "access.noteCode",
  forgot: "access.noteForgot",
  sent: "access.noteSent",
  reset: "access.noteReset",
  verified: "access.noteVerified",
  eu: "access.noteEu",
} satisfies Record<string, TranslationKey>;

/** The room or invitation keeps its URL and live state while the account page has the screen. */
export function AuthScreen({
  step,
  title,
  onBack,
  children,
}: {
  step: keyof typeof notes;
  title: string;
  onBack?: () => void;
  children: ReactNode;
}) {
  const { t, lang, productName, compliance } = useI18n();
  const heading = useRef<HTMLHeadingElement>(null);
  const zone = compliance.zone;
  useLayoutEffect(() => {
    const previous = document.activeElement;
    heading.current?.focus({ preventScroll: true });
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, [step]);
  return createPortal(
    <div
      className="auth-page"
      data-step={step}
      onKeyDown={(event) => {
        if (event.key === "Escape" && onBack) {
          event.stopPropagation();
          onBack();
        }
      }}
    >
      <div className={step === "eu" ? "auth-page-columns signup-screen" : "auth-page-columns"}>
        <aside className="signup-aside auth-paper">
          <a
            className="auth-brand"
            href="/"
            onClick={
              onBack
                ? (event) => {
                    event.preventDefault();
                    onBack();
                  }
                : undefined
            }
          >
            <BrandMark size={34} wordmark={brandName({ locale: lang, productName })} />
          </a>
          <div className="auth-illustration" aria-hidden="true">
            <i />
            <i />
            <i />
            <span>{t(notes[step])}</span>
          </div>
          <p className="signup-aside-foot">
            {t("signup.free")}
            {zone === "eu" ? t("signup.dataEu") : zone === "ru" ? t("signup.dataRu") : ""}
          </p>
        </aside>
        <main className="signup-main" aria-labelledby="access-heading">
          <div className="auth-sheet">
            <h1 id="access-heading" tabIndex={-1} ref={heading}>
              {title}
            </h1>
            {children}
          </div>
        </main>
      </div>
    </div>,
    document.body,
  );
}
