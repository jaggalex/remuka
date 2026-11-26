import { useState } from "react";
import { Button, Dialog, Input } from "@remo/ui";
import { api, ApiError } from "./api";
import { useI18n } from "./i18n";
import { SessionsDialog } from "./SessionsDialog";
import { SecurityDialog } from "./mfa/SecurityDialog";

export function AccountSecurity() {
  const { t } = useI18n();
  const [editor, setEditor] = useState<"password" | "factor" | null>(null);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const signIn = () => window.location.replace("/?signin=1");

  function close() {
    if (busy) return;
    setEditor(null);
    setCurrent("");
    setNext("");
    setError("");
  }

  async function change(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api.changePassword({ currentPassword: current, newPassword: next });
      signIn();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "";
      setError(t(code === "INVALID_CREDENTIALS" ? "account.deleteWrongPassword" : code === "WEAK_PASSWORD" ? "auth.weak" : "auth.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="account-setting-row">
        <strong>{t("auth.password")}</strong>
        <Button onClick={() => setEditor("password")}>{t("account.changePassword")}</Button>
      </div>
      <section className="account-devices">
        <h3>{t("account.devices")}</h3>
        <SessionsDialog open inline onClose={close} onCurrentRevoked={signIn} />
      </section>
      <Button variant="ghost" onClick={() => setEditor("factor")}>{t("mfa.title")}</Button>
      <SecurityDialog open={editor === "factor"} onClose={close} />
      {editor === "password" && (
        <Dialog title={t("account.changePassword")} onClose={close}>
          <form className="dialog-stack" onSubmit={change}>
            <Input label={t("account.deletePassword")} type="password" autoComplete="current-password" required
              value={current} onChange={e => setCurrent(e.currentTarget.value)} />
            <Input label={t("account.newPassword")} hint={t("auth.passwordHint")} type="password" autoComplete="new-password" required
              value={next} onChange={e => setNext(e.currentTarget.value)} />
            <p>{t("account.signInAfterChange")}</p>
            {error && <p className="auth-error" role="alert">{error}</p>}
            <Button type="submit" variant="primary" disabled={!current || !next} loading={busy}>{t("account.save")}</Button>
          </form>
        </Dialog>
      )}
    </>
  );
}
