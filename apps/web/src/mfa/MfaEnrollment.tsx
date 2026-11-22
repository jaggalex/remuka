import { useState } from "react";
import { Button, Checkbox, Input } from "@remo/ui";
import { useI18n } from "../i18n";
import { MfaCodes } from "./MfaCodes";
import { MfaQrCode } from "./MfaQrCode";
import { mfaApi } from "./mfaApi";
import { mfaErrorText } from "./mfaError";

/**
 * Turning the second factor on (`spec/totp.md` §4).
 *
 * Four steps in one component because they are one act: password, key, first code, saved
 * recovery codes. The server keeps the secret sealed; this screen sees it once, in the
 * answer to `begin`, and cannot ask for it again — a reload starts from the password.
 *
 * The QR is drawn from the `otpauth://` line in the browser (`MfaQrCode`, no network); the
 * key and the link stay as the text alternative for a camera that is not available.
 */
type Stage = "password" | "secret" | "codes" | "done";

export function MfaEnrollment({ onDone }: { onDone?: () => void }) {
  const { t } = useI18n();
  const [stage, setStage] = useState<Stage>("password");
  const [password, setPassword] = useState("");
  const [secret, setSecret] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const begin = async () => {
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      const started = await mfaApi.begin(password);
      setSecret(started);
      setPassword("");
      setStage("secret");
    } catch (failure) {
      setError(mfaErrorText(failure, t, { password: true }));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!code || busy) return;
    setBusy(true);
    setError(null);
    try {
      const confirmed = await mfaApi.confirm(code);
      setCodes(confirmed.recoveryCodes);
      setCode("");
      setStage("codes");
    } catch (failure) {
      setError(mfaErrorText(failure, t));
    } finally {
      setBusy(false);
    }
  };

  if (stage === "password") {
    return (
      <form
        className="mfa-stack"
        onSubmit={(event) => {
          event.preventDefault();
          void begin();
        }}
      >
        <p className="mfa-note">{t("mfa.description")}</p>
        <Input
          type="password"
          label={t("mfa.password")}
          hint={t("mfa.passwordHint")}
          autoComplete="current-password"
          error={error ?? undefined}
          value={password}
          onChange={(event) => setPassword(event.currentTarget.value)}
        />
        <div className="mfa-actions">
          <Button type="submit" variant="primary" loading={busy} disabled={!password}>
            {t("mfa.begin")}
          </Button>
        </div>
      </form>
    );
  }

  if (stage === "secret" && secret) {
    return (
      <form
        className="mfa-stack"
        onSubmit={(event) => {
          event.preventDefault();
          void confirm();
        }}
      >
        <strong>{t("mfa.secretTitle")}</strong>
        <p className="mfa-note">{t("mfa.secretHint")}</p>
        <div className="mfa-qr-placeholder">
          <MfaQrCode uri={secret.uri} label={t("mfa.qr")} />
          <span className="mfa-note">{t("mfa.secretLabel")}</span>
          <code className="mfa-secret">{secret.secret}</code>
          <a className="mfa-link" href={secret.uri}>
            {t("mfa.openApp")}
          </a>
        </div>
        <Input
          label={t("mfa.code")}
          hint={t("mfa.codeHint")}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          error={error ?? undefined}
          value={code}
          onChange={(event) => setCode(event.currentTarget.value.replace(/\s/g, ""))}
        />
        <div className="mfa-actions">
          <Button type="submit" variant="primary" loading={busy} disabled={code.length !== 6}>
            {t("mfa.confirm")}
          </Button>
        </div>
      </form>
    );
  }

  if (stage === "codes") {
    return (
      <div className="mfa-stack">
        <strong>{t("mfa.codesTitle")}</strong>
        <p className="mfa-note">{t("mfa.codesHint")}</p>
        <MfaCodes codes={codes} />
        <Checkbox
          label={t("mfa.saved")}
          checked={saved}
          onChange={(event) => setSaved(event.currentTarget.checked)}
        />
        <div className="mfa-actions">
          <Button
            variant="primary"
            disabled={!saved}
            onClick={() => {
              setCodes([]);
              setStage("done");
              onDone?.();
            }}
          >
            {t("mfa.done")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mfa-stack">
      <p className="mfa-note">{t("mfa.enabled")}</p>
      <div className="mfa-actions">
        <Button variant="primary" onClick={() => onDone?.()}>
          {t("mfa.done")}
        </Button>
      </div>
    </div>
  );
}
