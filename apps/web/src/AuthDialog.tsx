import { useEffect, useMemo, useState } from "react";
import { Button, Dialog, Input, Link, Tabs } from "@remo/ui";
import { api, type SessionUser } from "./api";
import { ApiError } from "./apiCall";
import { authCapabilities, type AuthCapabilities } from "./apiMail";
import { useI18n } from "./i18n";
import { LegalConsent } from "./legal/LegalConsent";
import { signupLegalDocuments } from "./legal/legalConfig";
import { announceLegalSession } from "./legal/legalSession";
/**
 * Sign in or create an account.
 *
 * A dialog rather than a route: the board stays mounted behind it, so a person who
 * opens a protected link lands on the board they meant to see and signs in on top of it
 * instead of losing the URL. Password reset is offered only when the server can send
 * mail; without it the dialog says who can help instead of promising a letter
 * (spec/mail.md §7, ADR-246).
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
  const { t, legal, refreshLegal } = useI18n();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The second step is a different form in the same dialog, not a new page (§5.2). */
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [capabilities, setCapabilities] = useState<AuthCapabilities | null>(null);
  // A box starts empty and only a person fills it (§1). The server requires the same list
  // again, so this state is a convenience, never the decision.
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const signupDocuments = useMemo(() => signupLegalDocuments(legal), [legal]);
  const consentComplete = signupDocuments.every((document) => checked[document.doc]);

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

  // A closed and reopened dialog starts with empty boxes again: consent is an action for
  // this attempt, not a setting remembered by the form.
  useEffect(() => {
    if (open) setChecked({});
    else {
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
        const code = failure instanceof Error ? (failure as { code?: string }).code ?? "" : "";
        const reason = failure instanceof ApiError ? failure.details.reason : undefined;
        setError(
          code === "MFA_INVALID" || code === "INVALID_CREDENTIALS"
            ? t("auth.mfaWrong")
            : code === "MFA_LOCKED"
              ? reason === "challenge"
                ? t("auth.mfaRetryPassword")
                : t("auth.mfaLocked")
              : code === "RATE_LIMITED"
                ? t("auth.mfaLocked")
                : t("auth.failed"),
        );
        // A dead challenge or a locked account has no second attempt: the password must be
        // entered again, and the form says so instead of letting the person retype codes.
        if (code === "MFA_LOCKED" || code === "RATE_LIMITED") {
          setChallenge(null);
          setCode("");
        }
      } finally {
        setBusy(false);
      }
      return;
    }
    if (mode === "register" && !consentComplete) {
      setError(t("legal.register.required"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result =
        mode === "register"
          ? await api.register({
              email,
              password,
              name: name || email.split("@")[0] || "You",
              acceptances: signupDocuments.map(({ doc, version, sha256 }) => ({
                doc,
                version,
                sha256,
              })),
            })
          : await api.login({ email, password });
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
      if (code === "LEGAL_ACCEPTANCE_REQUIRED") {
        setError(t("legal.register.required"));
        void refreshLegal();
        setChecked({});
      } else if (code === "LEGAL_VERSION_CHANGED") {
        // The text moved while the form was open. Re-read the registry and make the person
        // read and tick the current revision instead of retrying a hash they no longer saw.
        setError(t("legal.register.changed"));
        void refreshLegal();
        setChecked({});
      } else {
        setError(
          code === "INVALID_CREDENTIALS"
            ? capabilities && !capabilities.passwordReset
              ? t("auth.adminReset")
              : t("auth.wrong")
            : code === "EMAIL_TAKEN"
              ? t("auth.taken")
              : code === "WEAK_PASSWORD"
                ? t("auth.weak")
                : t("auth.failed"),
        );
      }
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
            <Tabs
              label={t("auth.title")}
              tabs={[
                { id: "login", label: t("auth.login") },
                { id: "register", label: t("auth.register") },
              ]}
              value={mode}
              onChange={(id) => setMode(id as typeof mode)}
            />

            {mode === "register" && (
              <Input label={t("auth.name")} value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" />
            )}
            <Input
              label={t("auth.email")}
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
              />
            <Input
              label={t("auth.password")}
                type="password"
                required
                minLength={mode === "register" ? 10 : undefined}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={mode === "register" ? "new-password" : "current-password"}
              />

            {mode === "login" && capabilities?.passwordReset && (
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
            {mode === "register" && <p className="auth-hint">{t("auth.passwordHint")}</p>}
            {mode === "register" && (
              <LegalConsent
                documents={signupDocuments}
                all={legal}
                checked={checked}
                onChange={(doc, value) =>
                  setChecked((current) => ({ ...current, [doc]: value }))
                }
              />
            )}
            {mode === "login" && notice && <p className="auth-hint">{notice}</p>}
            {error && <p className="auth-error">{error}</p>}

            <div className="auth-actions">
              <Button onClick={onClose}>{t("auth.cancel")}</Button>
              <Button
                type="submit"
                variant="primary"
                disabled={busy || (mode === "register" && !consentComplete)}
              >
                {busy ? t("auth.working") : mode === "register" ? t("auth.create") : t("auth.enter")}
              </Button>
            </div>
          </>
        )}
      </form>
    </Dialog>
  );
}
