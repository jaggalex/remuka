import { useEffect, useState } from "react";
import { Button, Link, Select, Switch } from "@remo/ui";
import { api, ApiError, type SessionUser } from "./api";
import { useI18n, type TranslationKey } from "./i18n";
import { useConsent } from "./ConsentProvider";
import { useTheme } from "./useTheme";
import { useCalmMotion } from "./useMotion";
import { useAccountPreferences } from "./useAccountPreferences";
import { AccountDeletionDialog } from "./AccountDeletion";
import { AuthDialog } from "./AuthDialog";
import { AccountProfile } from "./AccountProfile";
import { AccountSecurity } from "./AccountSecurity";
import { LegalDocumentsPage } from "./legal/LegalDocumentsPage";
import "./styles/account-page.css";

const headings = {
  profile: "account.profile", look: "account.look", security: "account.securityTitle",
  docs: "legal.documents", delete: "account.deleteTitle",
} as const satisfies Record<string, TranslationKey>;

type Section = keyof typeof headings;

function currentSection(): Section {
  const hash = window.location.hash.slice(1);
  return Object.hasOwn(headings, hash) ? hash as Section : "profile";
}

function returnHref() {
  const params = new URLSearchParams(location.search);
  params.delete("account");
  params.delete("signin");
  return location.pathname + (params.size ? "?" + params.toString() : "");
}

export function AccountSettingsPage() {
  const { t, lang, setLang } = useI18n();
  const { theme, setTheme } = useTheme();
  const { calm, setCalm } = useCalmMotion();
  const { openSettings } = useConsent();
  const [requestedSection, setSection] = useState(currentSection);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "guest" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  const [scheduled, setScheduled] = useState(false);
  const section = scheduled ? "delete" : requestedSection;
  useAccountPreferences({ me: user, theme, setTheme, lang, setLang, calm, setCalm });

  useEffect(() => {
    let alive = true;
    api.me().then(({ user }) => {
      if (alive) { setUser(user); setStatus(user ? "ready" : "guest"); }
    }).catch(error => {
      if (alive) setStatus(error instanceof ApiError && error.status === 401 ? "guest" : "error");
    });
    return () => { alive = false; };
  }, [attempt]);

  useEffect(() => {
    const update = () => setSection(currentSection());
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);

  const signInUrl = new URL(window.location.href);
  signInUrl.searchParams.set("signin", "1");
  const [authOpen, setAuthOpen] = useState(() => new URLSearchParams(location.search).get("signin") === "1");
  const closeAuth = () => {
    setAuthOpen(false);
    const url = new URL(location.href);
    url.searchParams.delete("signin");
    history.replaceState(null, "", url);
  };
  const home = returnHref();
  const exit = () => window.location.assign(scheduled ? "/" : home);

  return (
    <main className="account-page">
      <div className="account-page-inner">
        <header className="account-page-heading">
          <h1>{t("account.pageTitle")}</h1>
          <Link href={scheduled ? "/" : home}>{t("account.return")}</Link>
        </header>
        {status !== "ready" ? <section aria-live="polite">
          {status === "loading" && t("sessions.loading")}
          {status === "guest" && <Link href={signInUrl.pathname + signInUrl.search + signInUrl.hash}>{t("auth.login")}</Link>}
          {status === "error" && <><p>{t("auth.failed")}</p><Button onClick={() => { setStatus("loading"); setAttempt(n => n + 1); }}>{t("contained.panel.retry")}</Button></>}
        </section> : user && <div className="account-page-layout">
          {!scheduled && <nav aria-label={t("account.sections")}>
            {(Object.keys(headings) as Section[]).map(id => (
              <a key={id} href={"#" + id} aria-current={section === id ? "page" : undefined}
                className={id === "delete" ? "account-delete-link" : undefined}>{t(headings[id])}</a>
            ))}
          </nav>}
          <section className="account-page-card" aria-labelledby="account-section">
            <h2 id="account-section">{t(headings[section])}</h2>
            {section === "profile" && <AccountProfile user={user} onSaved={setUser} />}
            {section === "look" && <>
              <fieldset className="account-theme-picker"><legend>{t("theme.label")}</legend>
                {(["light", "dark", "system"] as const).map(value => (
                  <Button key={value} selected={theme === value} onClick={() => setTheme(value)}>
                    <span aria-hidden="true" className="theme-preview">
                      {value !== "dark" && <span data-theme="light" />}
                      {value !== "light" && <span data-theme="dark" />}
                    </span>
                    {t(`theme.${value}`)}
                  </Button>
                ))}
              </fieldset>
              <div className="account-look-settings">
                <Select label={t("account.language")} hint={t("account.languageHint")} value={lang}
                  options={[{ value: "ru", label: t("lang.ru") }, { value: "en", label: t("lang.en") }]}
                  onChange={e => setLang(e.currentTarget.value === "ru" ? "ru" : "en")} />
                <div className="account-motion-setting">
                  <div>
                    <label htmlFor="account-calm">{t("account.motion")}</label>
                    <p id="account-calm-hint">{t("account.motionHint")}</p>
                  </div>
                  <Switch id="account-calm" aria-describedby="account-calm-hint"
                    checked={calm} onChange={e => setCalm(e.currentTarget.checked)} />
                </div>
              </div>
              <p>{t("account.prefHint")}</p>
            </>}
            {section === "security" && <AccountSecurity />}
            {section === "docs" && <><LegalDocumentsPage inline /><Button onClick={openSettings}>{t("consent.link")}</Button></>}
            {section === "delete" && <>
              <p>{t("account.deleteBody")}</p>
              <AccountDeletionDialog open inline onClose={exit} onScheduled={() => setScheduled(true)}
                onCancelled={() => window.location.replace("/?signin=1")} />
            </>}
          </section>
        </div>}
      </div>
      {status === "guest" && <AuthDialog open={authOpen} onClose={closeAuth}
        onSignedIn={account => { setUser(account); setStatus("ready"); }} />}
    </main>
  );
}
