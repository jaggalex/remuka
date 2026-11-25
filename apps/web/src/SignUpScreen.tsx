import { useMemo, useState } from "react";
import { BrandMark, Button, Input } from "@remo/ui";
import { brandName } from "@remo/brand";
import { api } from "./api";
import { useI18n } from "./i18n";
import { LegalConsent } from "./legal/LegalConsent";
import { signupLegalDocuments } from "./legal/legalConfig";
import { announceLegalSession } from "./legal/legalSession";
import { Shake } from "./Shake";

/**
 * The one registration screen, Russian and European (ADR-265 stage 3, ADR-256 §3).
 *
 * It is a page, not a dialog: the mockup App-SignUp gives the form a paper aside with the
 * product's stickers, and a person who is not signed in has no room behind it to return to.
 * `?signup=1` is the address, the same way `?legal=documents` is a page.
 *
 * The checkboxes are not drawn here: `GET /config` says which documents this installation
 * requires, the form shows exactly those, and the server checks the same list again. The
 * Russian zone gets the offer and the separate consent; the European one gets the terms
 * and the privacy policy (ADR-256 §3). No document means no dashed box at all — a self-host
 * installation must not promise a consent it does not keep.
 */
export function SignUpScreen() {
  const { t, lang, legal, productName } = useI18n();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const documents = useMemo(() => signupLegalDocuments(legal), [legal]);
  const complete = documents.every((document) => checked[document.doc]);
  const zone = legal[0]?.zone ?? "";
  const dataLine = zone === "ru" ? t("signup.dataRu") : zone === "eu" ? t("signup.dataEu") : "";

  const refuse = (message: string) => {
    setError(message);
    setShake((value) => value + 1);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!complete) {
      refuse(documents.length === 2 ? t("legal.register.requiredTwo") : t("legal.register.requiredOne"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.register({
        email,
        password,
        name: name || email.split("@")[0] || "You",
        acceptances: documents.map(({ doc, version, sha256 }) => ({ doc, version, sha256 })),
      });
      announceLegalSession();
      setPassword("");
      setDone(true);
    } catch (failure) {
      const code = failure instanceof Error ? (failure as { code?: string }).code ?? "" : "";
      refuse(
        code === "EMAIL_TAKEN"
          ? t("auth.taken")
          : code === "WEAK_PASSWORD"
            ? t("auth.weak")
            : code === "LEGAL_VERSION_CHANGED"
              ? t("legal.register.changed")
              : code === "LEGAL_ACCEPTANCE_REQUIRED"
                ? t("legal.register.requiredTwo")
                : t("auth.failed"),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="signup-screen screen-motion">
      <aside className="signup-aside" aria-hidden="true">
        <BrandMark size={34} wordmark={brandName({ locale: lang, productName })} />
        <div className="signup-illustration">
          <span className="signup-sticker is-green">{t("signup.noteOne")}</span>
          <span className="signup-sticker is-yellow">{t("signup.noteTwo")}</span>
          <span className="signup-sticker is-pink">{t("signup.noteThree")}</span>
          <span className="signup-cursor">
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 3l16 7-7 2-2 7z" className="signup-cursor-arrow" />
            </svg>
            <span className="signup-cursor-name">{t("signup.youSoon")}</span>
          </span>
        </div>
        <p className="signup-aside-foot">
          {t("signup.free")}
          {dataLine}
        </p>
      </aside>

      <main className="signup-main">
        <Shake token={shake} className="signup-form-wrap">
          <form className="signup-form" aria-labelledby="signup-title" onSubmit={submit}>
            <div className="signup-heading">
              <h1 id="signup-title">{t("signup.title")}</h1>
              <p>
                {t("signup.haveAccount")}{" "}
                <a className="signup-signin" href="/?signin=1">
                  {t("auth.enter")}
                </a>
              </p>
            </div>

            <div className="signup-field">
              <Input
                label={t("signup.name")}
                autoComplete="name"
                value={name}
                onChange={(event) => setName(event.currentTarget.value)}
              />
              <p className="signup-hint">{t("signup.nameHint")}</p>
            </div>

            <div className="signup-field">
              <Input
                label={t("auth.email")}
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.currentTarget.value)}
              />
            </div>

            <div className="signup-field">
              <Input
                label={t("auth.password")}
                type="password"
                required
                minLength={10}
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.currentTarget.value)}
              />
              <p className="signup-hint">{t("auth.passwordHint")}</p>
            </div>

            {documents.length > 0 && (
              <div className={error ? "signup-consent is-error" : "signup-consent"}>
                <LegalConsent
                  documents={documents}
                  all={legal}
                  checked={checked}
                  error={error}
                  onChange={(doc, value) => {
                    const next = { ...checked, [doc]: value };
                    setChecked(next);
                    // Taking a tick back is the moment the consequence is worth saying:
                    // the person had a complete form and now the account cannot be made.
                    if (!value) {
                      refuse(
                        documents.length === 2
                          ? t("legal.register.requiredTwo")
                          : t("legal.register.requiredOne"),
                      );
                    } else if (documents.every((item) => next[item.doc])) {
                      setError(null);
                    }
                  }}
                />
              </div>
            )}

            {error && documents.length === 0 && <p className="signup-error" role="alert">{error}</p>}

            <Button
              type="submit"
              variant="primary"
              className="signup-submit"
              disabled={busy || (!complete && documents.length > 0) || done}
            >
              {done ? t("signup.created") : busy ? t("auth.working") : t("auth.create")}
            </Button>

            {done && (
              <p className="signup-done" role="status">
                {t("signup.doneBefore")}
                <a className="signup-signin" href="/">
                  {t("signup.doneLink")}
                </a>
                {t("signup.doneAfter")}
              </p>
            )}
          </form>
        </Shake>
      </main>
    </div>
  );
}
