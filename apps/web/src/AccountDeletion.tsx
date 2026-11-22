import { useState } from "react";
import { Banner, Button, Dialog, Input } from "@remo/ui";
import {
  cancelAccountDeletion,
  requestAccountDeletion,
  type DeletionSchedule,
} from "./accountDeletionApi";
import { ApiError } from "./apiCall";
import { formatDate } from "./format";
import { useI18n } from "./i18n";

/**
 * "Delete account" (ADR-257 §2): one confirmation, then a date and a way back.
 *
 * The password proves the person is present, the phrase makes the action deliberate. The
 * account stops working the moment the server answers, so the same screen switches to the
 * fourteen-day state: the due date, and the cancellation token that arrived in the letter
 * (kept in memory, never in storage).
 */
export function AccountDeletionDialog({
  open,
  onClose,
  onScheduled,
  onCancelled,
}: {
  open: boolean;
  onClose: () => void;
  onScheduled: (schedule: DeletionSchedule) => void;
  onCancelled: () => void;
}) {
  const { t, lang } = useI18n();
  const [password, setPassword] = useState("");
  const [phrase, setPhrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scheduled, setScheduled] = useState<DeletionSchedule | null>(null);
  const [cancelled, setCancelled] = useState(false);

  if (!open) return null;

  const reset = () => {
    setPassword("");
    setPhrase("");
    setError(null);
    setScheduled(null);
    setCancelled(false);
  };

  const close = () => {
    reset();
    onClose();
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await requestAccountDeletion({ password, phrase: phrase.trim() });
      setScheduled(result);
      setPassword("");
      setPhrase("");
      onScheduled(result);
    } catch (failure) {
      const error = failure instanceof ApiError ? failure : null;
      const code = error?.code ?? "";
      if (code === "INVALID_CREDENTIALS") setError(t("account.deleteWrongPassword"));
      else if (code === "BAD_PHRASE") setError(t("account.deleteBadPhrase"));
      else if (code === "LAST_ADMIN") {
        const orgs = Array.isArray(error?.details.orgs)
          ? (error.details.orgs as Array<{ name?: string }>)
              .map((org) => org.name ?? "")
              .filter(Boolean)
          : [];
        setError(
          orgs.length
            ? t("account.deleteBlocked", { orgs: orgs.join(", ") })
            : t("account.deleteBlockedUnknown"),
        );
      } else setError(t("account.deleteFailed"));
    } finally {
      setBusy(false);
    }
  };

  const undo = async () => {
    if (busy || !scheduled) return;
    setBusy(true);
    setError(null);
    try {
      await cancelAccountDeletion({ token: scheduled.restoreToken });
      setCancelled(true);
      setScheduled(null);
      onCancelled();
    } catch (failure) {
      const code = failure instanceof ApiError ? failure.code : "";
      setError(code === "TOO_LATE" ? t("account.deleteCancelTooLate") : t("account.deleteCancelFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title={t("account.deleteTitle")} description={t("account.deleteBody")} size="sm" onClose={close}>
      {cancelled ? (
        <div className="dialog-stack">
          <p className="auth-hint">{t("account.deleteCancelled")}</p>
          <div className="auth-actions">
            <Button variant="primary" onClick={close}>
              {t("account.deleteClose")}
            </Button>
          </div>
        </div>
      ) : scheduled ? (
        <div className="dialog-stack">
          <p className="auth-hint">
            {t("account.deleteScheduled", { date: formatDate(scheduled.deletionAt, lang) })}
          </p>
          <p className="auth-hint">{t("account.deleteCancelHint")}</p>
          <div className="auth-actions">
            <Button variant="secondary" loading={busy} onClick={() => void undo()}>
              {t("account.deleteCancel")}
            </Button>
            <Button variant="primary" onClick={close}>
              {t("account.deleteClose")}
            </Button>
          </div>
        </div>
      ) : (
        <form className="dialog-stack" onSubmit={submit}>
          <Input
            label={t("account.deletePassword")}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.currentTarget.value)}
          />
          <Input
            label={t("account.deletePhrase")}
            hint={t("account.deletePhraseHint")}
            value={phrase}
            maxLength={16}
            onChange={(event) => setPhrase(event.currentTarget.value)}
          />
          {error && <p className="auth-error">{error}</p>}
          <div className="auth-actions">
            <Button type="submit" variant="primary" loading={busy} disabled={!password || !phrase.trim()}>
              {t("account.deleteConfirm")}
            </Button>
            <Button variant="ghost" onClick={close}>
              {t("account.deleteClose")}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

/** The home banner between the request and the erasure: the date and the way back. */
export function AccountDeletionBanner({
  schedule,
  onCancelled,
}: {
  schedule: DeletionSchedule | null;
  onCancelled: () => void;
}) {
  const { t, lang } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!schedule) return null;
  const undo = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await cancelAccountDeletion({ token: schedule.restoreToken });
      onCancelled();
    } catch (failure) {
      const code = failure instanceof ApiError ? failure.code : "";
      setError(code === "TOO_LATE" ? t("account.deleteCancelTooLate") : t("account.deleteCancelFailed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Banner
      tone="warning"
      title={t("account.deleteBanner", {
        date: formatDate(schedule.deletionAt, lang),
      })}
      action={{ label: t("account.deleteCancel"), onClick: () => void undo() }}
    >
      {error ?? t("account.deleteCancelHint")}
    </Banner>
  );
}
