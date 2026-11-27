import { useEffect, useState } from "react";
import { Button, Input } from "@remo/ui";
import { AuthScreen } from "./AuthScreen";
import { ApiError } from "./apiCall";
import { forgotPassword } from "./apiMail";
import { useI18n } from "./i18n";

/**
 * "Forgot password" (ADR-246, `spec/mail.md` §7).
 *
 * The answer never says whether the address exists: after any server reply the form
 * shows one sentence, so the screen cannot be used to enumerate accounts. Only a
 * network failure is reported separately — there the request never reached the server.
 */
export function ForgotPasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [wait, setWait] = useState(0);
  useEffect(() => {
    if (!wait) return;
    const timer = window.setTimeout(() => setWait(wait - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [wait]);
  if (!open) return null;

  const send = async () => {
    if (busy || wait) return;
    setBusy(true);
    setError(null);
    try {
      await forgotPassword(email.trim());
      setSent(true);
      setWait(60);
    } catch (failure) {
      setError(
        failure instanceof ApiError
          ? failure.status === 429
            ? t("mail.rateLimited")
            : t("auth.failed")
          : t("mail.networkError"),
      );
    } finally {
      setBusy(false);
    }
  };

  const [beforeEmail, afterEmail] = t("access.sentBody", { email: "{email}" }).split("{email}");
  return (
    <AuthScreen
      step={sent ? "sent" : "forgot"}
      title={t(sent ? "access.sentTitle" : "mail.forgotTitle")}
      onBack={onClose}
    >
      {sent ? (
        <>
          <span className="auth-letter" aria-hidden="true"><i /></span>
          <p role="status">{beforeEmail}<strong>{email.trim()}</strong>{afterEmail}</p>
          <Button onClick={onClose}>{t("access.openedMail")}</Button>
          <Button
            variant="ghost"
            size="compact"
            type="button"
            className="access-link"
            disabled={busy || wait > 0}
            onClick={() => void send()}
          >
            {wait
              ? t("access.wait", { time: Math.floor(wait / 60) + ":" + String(wait % 60).padStart(2, "0") })
              : t("mail.resend")}
          </Button>
        </>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <p>{t("mail.forgotBody")}</p>
          <Input
            label={t("auth.email")}
            type="email"
            required
            value={email}
            autoComplete="email"
            onChange={(event) => setEmail(event.target.value)}
          />
          <Button
            type="submit"
            variant="primary"
            className="signup-submit"
            disabled={busy || !email.trim()}
          >
            {busy ? t("auth.working") : t("mail.sendLink")}
          </Button>
          <Button variant="ghost" size="compact" type="button" className="access-link" onClick={onClose}>
            {t("access.remembered")}
          </Button>
        </form>
      )}
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
    </AuthScreen>
  );
}
