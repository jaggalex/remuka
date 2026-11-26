import { useState } from "react";
import { Button, Input } from "@remo/ui";
import { AuthScreen } from "./AuthScreen";
import { ApiError } from "./apiCall";
import { resetPassword } from "./apiMail";
import { useI18n } from "./i18n";

type Refusal = "invalid" | "expired" | null;

/**
 * A new password from a one-time link (ADR-246, `spec/mail.md` §7).
 *
 * The token is already out of the address before this dialog mounts. There is no
 * automatic sign-in on success: a leaked link may change the password, but it must not
 * hand out a session. The requirements for a password are the server's; the form only
 * repeats its minimum length and shows the server's refusal, not a second rulebook.
 */
export function ResetPasswordDialog({
  token,
  onClose,
  onNeedLink,
  onDone,
}: {
  token: string;
  onClose: () => void;
  /** Opens the "Forgot password" form: `?forgot=1`. */
  onNeedLink: () => void;
  /** The password changed; the caller opens sign-in with the success notice. */
  onDone: () => void;
}) {
  const { t } = useI18n();
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<Refusal>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await resetPassword(token, password);
      setPassword("");
      onDone();
    } catch (failure) {
      const code = failure instanceof ApiError ? failure.code : "";
      if (code === "TOKEN_EXPIRED") setRefusal("expired");
      else if (code === "TOKEN_INVALID") setRefusal("invalid");
      else if (code === "WEAK_PASSWORD") setError(t("auth.weak"));
      else if (code === "RATE_LIMITED") setError(t("mail.rateLimited"));
      else if (failure instanceof ApiError) setError(t("auth.failed"));
      else setError(t("mail.networkError"));
    } finally {
      setBusy(false);
    }
  };

  const score = Math.min(
    4,
    (password.length >= 10 ? 2 : password.length >= 6 ? 1 : 0) +
      Number(/\d/.test(password)) +
      Number(/[^\p{L}\d]/u.test(password)),
  );
  return (
    <AuthScreen step="reset" title={t("mail.resetTitle")} onBack={onClose}>
      {refusal ? (
        <div className="dialog-stack">
          <p className="auth-error">
            {refusal === "expired" ? t("mail.tokenExpired") : t("mail.tokenInvalid")}
          </p>
          <div className="auth-actions">
            <Button onClick={onClose}>{t("auth.cancel")}</Button>
            <Button variant="primary" onClick={onNeedLink}>
              {t("mail.requestNewLink")}
            </Button>
          </div>
        </div>
      ) : (
        <form className="dialog-stack" onSubmit={submit}>
          <div className="auth-password">
            <Input
              label={t("auth.password")}
              type={show ? "text" : "password"}
              required
              minLength={10}
              value={password}
              autoComplete="new-password"
              onChange={(event) => setPassword(event.target.value)}
            />
            <Button
              className="access-link access-forgot"
              type="button"
              size="compact"
              variant="ghost"
              selected={show}
              onClick={() => setShow((value) => !value)}
            >
              {show ? t("mail.hide") : t("mail.show")}
            </Button>
          </div>
          <div className="auth-strength" aria-hidden="true">
            {[1, 2, 3, 4].map((n) => (
              <span key={n} className={n <= score ? "is-filled" : ""} />
            ))}
          </div>
          <p>
            {t(
              !password
                ? "access.strengthEmpty"
                : password.length < 10
                  ? "access.strengthShort"
                  : score >= 3
                    ? "access.strengthGood"
                    : "access.strengthFair",
            )}
          </p>
          {error && <p className="auth-error">{error}</p>}
          <Button type="submit" variant="primary" className="signup-submit" disabled={busy}>
            {busy ? t("auth.working") : t("mail.savePassword")}
          </Button>
          <p className="auth-reset-foot">{t("access.resetFoot")}</p>
        </form>
      )}
    </AuthScreen>
  );
}
