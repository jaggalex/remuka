import { Button, Icon, Input } from "@remo/ui";
import { useState } from "react";
import { api, ApiError } from "./api";
import { useI18n } from "./i18n";
import { RoomGateCard } from "./RoomGateCard";

/** Server-side link access. The password gate reveals no private room metadata. */
export function LinkPasswordGate({ boardId, onUnlocked }: { boardId: string; onUnlocked: () => void }) {
  const { t } = useI18n();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  async function unlock() {
    if (busy || !password) return;
    setBusy(true);
    setError(null);
    try {
      await api.unlockLink(boardId, password);
      onUnlocked();
    } catch (failure) {
      const code = failure instanceof ApiError ? failure.code : "";
      setError(code === "WRONG_PASSWORD" ? t("guest.wrong")
        : code === "LINK_EXPIRED" ? t("iam.linkExpired") : t("guest.fail"));
      setAttempt(value => value + 1);
      setBusy(false);
    }
  }

  return (
    <RoomGateCard title={t("guest.gate")} description={t("guest.gateHelp")} attempt={attempt}
      illustration={<span className="guest-lock" aria-hidden="true"><Icon name="lock" size={30} /></span>}>
      <form className="guest-fields" onSubmit={event => { event.preventDefault(); void unlock(); }}>
        <Input type="password" autoFocus autoComplete="current-password" label={t("guest.password")}
          value={password} error={error ?? undefined}
          onChange={event => { setPassword(event.currentTarget.value); setError(null); }} />
        <Button className="signup-submit" variant="primary" type="submit" disabled={busy || !password}>
          {t("guest.unlock")}
        </Button>
      </form>
    </RoomGateCard>
  );
}
