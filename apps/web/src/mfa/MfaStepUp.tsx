import { useState } from "react";
import { Button, Dialog, Input } from "@remo/ui";
import { ApiError } from "../apiCall";
import { useI18n } from "../i18n";
import { operatorApi } from "../operator/operatorApi";
import { CodeCells } from "./CodeCells";
import { Shake } from "../Shake";
import { mfaErrorText } from "./mfaError";

/**
 * The console's step-up window (`spec/totp.md` §6).
 *
 * It appears only when the server answered `403 MFA_REQUIRED` with a challenge: reading
 * opens for twelve hours, changing actions for fifteen minutes after the same code. The
 * window is a Dialog rather than a page because the console is behind it, not replaced by
 * it — the person returns to the tab they opened.
 */
export function MfaStepUp({
  challenge,
  onDone,
  onRetry,
  onClose,
}: {
  challenge: string;
  onDone: (mfaAt: string) => void;
  /** Five wrong answers end this challenge; the console asks the server for a new one. */
  onRetry?: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [recovery, setRecovery] = useState(false);
  const [value, setValue] = useState("");
  const [shake, setShake] = useState(0);
  const valid = recovery ? Boolean(value.trim()) : /^\d{6}$/.test(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const body = recovery
        ? { challenge, recoveryCode: value }
        : { challenge, code: value };
      const result = await operatorApi.confirm(body);
      onDone(result.mfaAt ?? result.confirmedAt);
    } catch (failure) {
      setShake(n => n + 1);
      setError(mfaErrorText(failure, t));
      setValue("");
      if (
        failure instanceof ApiError &&
        failure.code === "MFA_LOCKED" &&
        failure.details.reason === "challenge"
      ) {
        onRetry?.();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={t("mfa.stepUpTitle")}
      description={t("mfa.stepUpBody")}
      size="sm"
      className="stepup-sheet"
      onClose={onClose}
    >
      <Shake token={shake}>
      <form
        className="mfa-stack"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {recovery
          ? <Input label={t("mfa.recovery")} hint={t("mfa.recoveryHint")} placeholder="xxxx-xxxx"
              autoComplete="off" error={error ?? undefined} value={value}
              onChange={event => setValue(event.currentTarget.value)} />
          : <CodeCells value={value} error={error} onChange={setValue} />}
        <div className="mfa-actions">
          <Button type="submit" variant="primary" loading={busy} disabled={!valid}>
            {t("mfa.stepUpConfirm")}
          </Button>
        <Button
          type="button"
          variant="ghost"
          size="compact"
          onClick={() => {
            setRecovery(!recovery);
            setValue("");
            setError(null);
          }}
        >
          {recovery ? t("mfa.codeToggle") : t("mfa.recoveryToggle")}
        </Button>
        </div>
      </form>
      </Shake>
    </Dialog>
  );
}
