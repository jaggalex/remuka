import { useState } from "react";
import { Avatar, Badge, Button, Input } from "@remo/ui";
import { ApiError, api, type SessionUser } from "./api";
import { useI18n } from "./i18n";

export function AccountProfile({ user, onSaved }: { user: SessionUser; onSaved: (next: SessionUser) => void }) {
  const { name, handle } = user;
  const { t } = useI18n();
  const [nameDraft, setNameDraft] = useState(name);
  const [handleDraft, setHandleDraft] = useState(handle);
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameSaved, setNameSaved] = useState(false);
  const saveName = async () => {
    const next = nameDraft.trim();
    const nextHandle = handleDraft.trim().toLowerCase();
    if (!next || !nextHandle || savingName) return;
    if (next === name && nextHandle === handle) return;
    setSavingName(true);
    setNameError(null);
    setNameSaved(false);
    try {
      const result = await api.renameAccount({ name: next, handle: nextHandle });
      onSaved(result.user);
      setNameSaved(true);
    } catch (failure) {
      const code = failure instanceof ApiError ? failure.code : "";
      setNameError(
        code === "HANDLE_TAKEN"
          ? t("account.handleTaken")
          : code === "BAD_HANDLE" || code === "HANDLE_TOO_SHORT" || code === "HANDLE_TOO_LONG" || code === "HANDLE_RESERVED"
            ? t("account.handleInvalid")
            : t("account.nameFailed"),
      );
    } finally {
      setSavingName(false);
    }
  };

  return (
    <form className="account-profile-form" onSubmit={event => { event.preventDefault(); void saveName(); }}>
      <div className="account-profile-who">
        <Avatar name={name} />
        <div><strong>{name}</strong><p>{t("account.profileHint")}</p></div>
      </div>
      <Input label={t("account.profileName")} value={nameDraft} maxLength={80}
        onChange={event => { setNameDraft(event.currentTarget.value); setNameSaved(false); }} />
      <Input label={t("account.profileHandle")} prefix="@"
        hint={handle && handleDraft === handle ? t("account.mentionExample", { handle }) : t("account.handleHint")}
        value={handleDraft} maxLength={32}
        onChange={event => { setHandleDraft(event.currentTarget.value); setNameSaved(false); }} />
      <div className="account-profile-email">
        <strong>{t("auth.email")}</strong>
        <span>{user.email}</span>
        <Badge tone={user.emailVerified ? "success" : "neutral"}>
          {t(user.emailVerified ? "account.verifiedEmail" : "account.unverifiedEmail")}
        </Badge>
      </div>
      {nameError && <p role="alert" className="auth-error">{nameError}</p>}
      <Button type="submit" variant="primary" loading={savingName}
        disabled={!nameDraft.trim() || !handleDraft.trim() || (nameDraft.trim() === name && handleDraft.trim().toLowerCase() === handle)}>
        {t("account.save")}
      </Button>
      {nameSaved && <p role="status">{t("account.nameSaved")}</p>}
    </form>
  );
}
