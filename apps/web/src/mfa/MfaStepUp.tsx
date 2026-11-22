import { useState } from "react";
import { Button, Dialog, Input } from "@remo/ui";
import { ApiError } from "../apiCall";
import { useI18n } from "../i18n";
import { operatorApi } from "../operator/operatorApi";
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!value || busy) return;
    setBusy(true);
    setError(null);
    try {
      const body = recovery
        ? { challenge, recoveryCode: value }
        : { challenge, code: value };
      const result = await operatorApi.confirm(body);
      onDone(result.mfaAt ?? result.confirmedAt);
    } catch (failure) {
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
      onClose={onClose}
    >
      <form
        className="mfa-stack"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Input
          label={recovery ? t("mfa.recovery") : t("mfa.code")}
          hint={recovery ? t("mfa.recoveryHint") : t("mfa.codeHint")}
          inputMode={recovery ? undefined : "numeric"}
          autoComplete={recovery ? "off" : "one-time-code"}
          maxLength={recovery ? undefined : 6}
          error={error ?? undefined}
          value={value}
          onChange={(event) =>
            setValue(
              recovery ? event.currentTarget.value : event.currentTarget.value.replace(/\s/g, ""),
            )
          }
        />
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
        <div className="mfa-actions">
          <Button type="submit" variant="primary" loading={busy} disabled={!value}>
            {t("mfa.stepUpConfirm")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
