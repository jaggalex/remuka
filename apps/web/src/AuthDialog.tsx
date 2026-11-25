import { useEffect, useState } from "react";
import { BrandMark, Button, Dialog, Input, Link } from "@remo/ui";
import { brandName } from "@remo/brand";
import { api, type SessionUser } from "./api";
import { ApiError } from "./apiCall";
import { authCapabilities, type AuthCapabilities } from "./apiMail";
import { useI18n } from "./i18n";
import { announceLegalSession } from "./legal/legalSession";
import { Shake } from "./Shake";

/**
 * Sign in.
 *
 * A dialog rather than a route: the board stays mounted behind it, so a person who
 * opens a protected link lands on the board they meant to see and signs in on top of it
 * instead of losing the URL. Password reset is offered only when the server can send
 * mail; without it the dialog says who can help instead of promising a letter
 * (spec/mail.md §7, ADR-246).
 *
 * Registration is its own page (`?signup=1`, `SignUpScreen.tsx`): the mockup App-SignUp is
 * a two-column screen with the consents and the paper aside, and a dialog cannot carry
 * that shape (ADR-265 stage 3, ADR-286).
 */
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
  const { t, lang, productName } = useI18n();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  /** The second step is a different form in the same dialog, not a new page (§5.2). */
  const [challenge, setChallenge] = useState<string | null>(null);
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
      setChallenge(null);
      setCode("");
      setUseRecovery(false);
      setError(null);
    }
  }, [open]);

  if (!open) return null;

  const openForgot = () => {
    if (onForgot) onForgot();
    else window.location.assign("/?forgot=1");
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
          useRecovery ? { challenge, recoveryCode: code } : { challenge, code },
        );
        announceLegalSession();
        onSignedIn(result.user);
        setCode("");
        setChallenge(null);
        onClose();
      } catch (failure) {
        const failureCode = failure instanceof Error ? (failure as { code?: string }).code ?? "" : "";
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
        setChallenge(result.challenge);
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
      const code = failure instanceof Error ? (failure as { code?: string }).code ?? "" : "";
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
    <Dialog
      title={challenge ? t("auth.mfaTitle") : t("auth.title")}
      description={challenge ? t("auth.mfaBody") : undefined}
      size="sm"
      onClose={onClose}
    >
      <div className="auth-brand">
        <BrandMark size={30} wordmark={brandName({ locale: lang, productName })} />
      </div>
      <Shake token={shake}>
        <form className="dialog-stack" onSubmit={submit}>
          {challenge ? (
            <>
              <Input
                label={useRecovery ? t("mfa.recovery") : t("auth.mfaCode")}
                hint={useRecovery ? t("mfa.recoveryHint") : t("mfa.codeHint")}
                inputMode={useRecovery ? undefined : "numeric"}
                autoComplete={useRecovery ? "off" : "one-time-code"}
                maxLength={useRecovery ? undefined : 6}
                autoFocus
                error={error ?? undefined}
                value={code}
                onChange={(event) =>
                  setCode(
                    useRecovery
                      ? event.currentTarget.value
                      : event.currentTarget.value.replace(/\s/g, ""),
                  )
                }
              />
              <Button
                type="button"
                variant="ghost"
                size="compact"
                onClick={() => {
                  setUseRecovery(!useRecovery);
                  setCode("");
                  setError(null);
                }}
              >
                {useRecovery ? t("auth.mfaUseCode") : t("auth.mfaUseRecovery")}
              </Button>
              <div className="auth-actions">
                <Button
                  type="button"
                  onClick={() => {
                    setChallenge(null);
                    setCode("");
                    setError(null);
                  }}
                >
                  {t("auth.mfaBack")}
                </Button>
                <Button type="submit" variant="primary" disabled={busy || !code}>
                  {busy ? t("auth.working") : t("auth.enter")}
                </Button>
              </div>
            </>
          ) : (
            <>
              <Input
                label={t("auth.email")}
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.currentTarget.value)}
                autoComplete="email"
              />
              <Input
                label={t("auth.password")}
                type="password"
                required
                value={password}
                onChange={(event) => setPassword(event.currentTarget.value)}
                autoComplete="current-password"
              />

              {capabilities?.passwordReset && (
                <Link
                  href="?forgot=1"
                  onClick={(event) => {
                    event.preventDefault();
                    openForgot();
                  }}
                >
                  {t("auth.forgot")}
                </Link>
              )}
              {notice && <p className="auth-hint">{notice}</p>}
              {error && <p className="auth-error" role="alert">{error}</p>}

              <p className="auth-switch">
                {t("auth.noAccount")}{" "}
                <a className="signup-signin" href={signupHref}>
                  {t("auth.signUpLink")}
                </a>
              </p>

              <div className="auth-actions">
                <Button onClick={onClose}>{t("auth.cancel")}</Button>
                <Button type="submit" variant="primary" disabled={busy}>
                  {busy ? t("auth.working") : t("auth.enter")}
                </Button>
              </div>
            </>
          )}
        </form>
      </Shake>
    </Dialog>
  );
}
