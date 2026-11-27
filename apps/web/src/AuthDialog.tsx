import { useEffect, useState } from "react";
import { Button, Input } from "@remo/ui";
import { AuthScreen } from "./AuthScreen";
import { ForgotPasswordDialog } from "./ForgotPasswordDialog";
import { api, type SessionUser } from "./api";
import { ApiError } from "./apiCall";
import { authCapabilities, type AuthCapabilities } from "./apiMail";
import { useI18n } from "./i18n";
import { announceLegalSession } from "./legal/legalSession";
import { Shake } from "./Shake";

/** The credential challenge stays in memory and the room/invite remains the navigation target. */
export function AuthDialog({
  open,
  onClose,
  onSignedIn,
  onForgot,
  notice,
}: {
  open: boolean;
  onClose: () => void;
  onSignedIn: (user: SessionUser) => void;
  /** Opens the "Forgot password" form; the board without one goes to the home route. */
  onForgot?: () => void;
  /** A result from the reset form, shown above the fields. */
  notice?: string | null;
}) {
  const { t, lang } = useI18n();
  const [roomForgot, setRoomForgot] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  /** The second step is a different form in the same dialog, not a new page (§5.2). */
  const [challenge, setChallenge] = useState<{ token: string; issuer?: string } | null>(null);
  const [code, setCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [capabilities, setCapabilities] = useState<AuthCapabilities | null>(null);

  // Asked on every open: an operator may enable mail while the app is running.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    authCapabilities()
      .then((result) => {
        if (alive) setCapabilities(result);
      })
      .catch(() => {
        if (alive) setCapabilities(null);
      });
    return () => {
      alive = false;
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      // A challenge is bound to one attempt at the password; closing the dialog drops it.
      setRoomForgot(false);
      setChallenge(null);
      setCode("");
      setUseRecovery(false);
      setError(null);
    }
  }, [open]);

  if (!open) return null;

  if (roomForgot) return <ForgotPasswordDialog open onClose={() => setRoomForgot(false)} />;

  const openForgot = () => {
    if (onForgot) onForgot();
    else setRoomForgot(true);
  };

  /** A refusal is said once, and the frame shakes its head once (ADR-265 §4.2). */
  const refuse = (message: string) => {
    setError(message);
    setShake((value) => value + 1);
  };

  const signupHref = lang === "ru" ? "/?signup=1&lang=ru" : "/?signup=1&lang=en";

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (challenge) {
      if (!code) return;
      setBusy(true);
      setError(null);
      try {
        const result = await api.loginMfa(
          useRecovery ? { challenge: challenge.token, recoveryCode: code } : { challenge: challenge.token, code },
        );
        announceLegalSession();
        onSignedIn(result.user);
        setCode("");
        setChallenge(null);
        onClose();
      } catch (failure) {
        const failureCode = failure instanceof Error ? ((failure as { code?: string }).code ?? "") : "";
        const reason = failure instanceof ApiError ? failure.details.reason : undefined;
        refuse(
          failureCode === "MFA_INVALID" || failureCode === "INVALID_CREDENTIALS"
            ? t("auth.mfaWrong")
            : failureCode === "MFA_LOCKED"
              ? reason === "challenge"
                ? t("auth.mfaRetryPassword")
                : t("auth.mfaLocked")
              : failureCode === "RATE_LIMITED"
                ? t("auth.mfaLocked")
                : t("auth.failed"),
        );
        // A dead challenge or a locked account has no second attempt: the password must be
        // entered again, and the form says so instead of letting the person retype codes.
        if (failureCode === "MFA_LOCKED" || failureCode === "RATE_LIMITED") {
          setChallenge(null);
          setCode("");
        }
      } finally {
        setBusy(false);
      }
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api.login({ email, password });
      if ("mfaRequired" in result && result.mfaRequired) {
        // The password was right; the session waits for the code. No reload and no new
        // screen: the dialog grows a second field (§5.1–2).
        setChallenge({ token: result.challenge, issuer: result.issuer });
        setCode("");
        setUseRecovery(false);
        setPassword("");
        return;
      }
      // The blocking window lives above this dialog and reads the journal itself; the
      // signal says only that a session now exists (§5).
      announceLegalSession();
      onSignedIn(result.user);
      setPassword("");
      onClose();
    } catch (failure) {
      const code = failure instanceof Error ? ((failure as { code?: string }).code ?? "") : "";
      refuse(
        code === "INVALID_CREDENTIALS"
          ? capabilities && !capabilities.passwordReset
            ? t("auth.adminReset")
            : t("auth.wrong")
          : code === "RATE_LIMITED"
            ? t("auth.mfaLocked")
            : t("auth.failed"),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthScreen
      step={challenge ? "code" : "login"}
      title={t(challenge ? "auth.mfaTitle" : "auth.title")}
      onBack={onClose}
    >
      <Shake token={shake}>
        <form onSubmit={submit}>
          {challenge ? (
            <>
              <p>{useRecovery ? t("mfa.recoveryHint") : challenge.issuer ? t("auth.mfaIssuerBody", { issuer: challenge.issuer }) : t("auth.mfaBody")}</p>
              <Input
                label={t(useRecovery ? "mfa.recovery" : "auth.mfaCode")}
                inputMode={useRecovery ? undefined : "numeric"}
                required
                autoComplete={useRecovery ? "off" : "one-time-code"}
                placeholder={useRecovery ? undefined : "000 000"}
                error={error ?? undefined}
                value={code}
                onChange={(event) =>
                  setCode(
                    useRecovery
                      ? event.currentTarget.value
                      : event.currentTarget.value.replace(/\D/g, "").slice(0, 6),
                  )
                }
              />
              <Button type="submit" variant="primary" className="signup-submit" disabled={busy}>
                {busy ? t("auth.working") : t("mfa.confirm")}
              </Button>
              <Button
                variant="ghost"
                size="compact"
                type="button"
                className="access-link"
                onClick={() => {
                  setUseRecovery(!useRecovery);
                  setCode("");
                  setError(null);
                }}
              >
                {t(useRecovery ? "auth.mfaUseCode" : "auth.mfaUseRecovery")}
              </Button>
            </>
          ) : (
            <>
              <p>
                {t("auth.noAccount")}{" "}
                <a className="signup-signin" href={signupHref}>
                  {t("auth.signUpLink")}
                </a>
              </p>
              <Input
                label={t("auth.email")}
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.currentTarget.value)}
              />
              <div className="auth-password">
                <Input
                  label={t("auth.password")}
                  type="password"
                  error={error === t("auth.wrong") ? error : undefined}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.currentTarget.value)}
                />
                {capabilities?.passwordReset && (
                  <a
                    className="signup-signin access-forgot"
                    href="?forgot=1"
                    onClick={(event) => {
                      event.preventDefault();
                      openForgot();
                    }}
                  >
                    {t("auth.forgot")}
                  </a>
                )}
              </div>
              {notice && (
                <p className="auth-hint" role="status">
                  {notice}
                </p>
              )}
              {error && error !== t("auth.wrong") && (
                <p className="auth-error" role="alert">
                  {error}
                </p>
              )}
              <Button type="submit" variant="primary" className="signup-submit" disabled={busy}>
                {busy ? t("auth.working") : t("auth.enter")}
              </Button>
            </>
          )}
        </form>
      </Shake>
    </AuthScreen>
  );
}
