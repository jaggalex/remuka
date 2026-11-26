import { useState } from "react";
import { Button, Dialog, Icon, Input } from "@remo/ui";
import { useI18n } from "./i18n";
import type { Identity } from "./identity";
import { GuestNameNotice } from "./legal/GuestNameNotice";

export function GuestLinkEntry({ identity, renameSelf }: { identity: Identity; renameSelf: (value: string) => void }) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  if (identity.guestNameConfirmed || identity.override) {
    return <p className="guest-room-note">{t("guest.view")}</p>;
  }
  const generated = /^Guest ([0-9a-f]{4})$/.exec(identity.name);
  const aliases = ["guest.suggested", "guest.suggestedFox", "guest.suggestedOwl", "guest.suggestedOtter"] as const;
  const fallback = generated ? t(aliases[parseInt(generated[1]!, 16) % aliases.length]!) : identity.name;
  const shown = name.trim() || fallback;
  return (
    <Dialog title={t("guest.nameTitle")} description={t("guest.nameHelp", { name: fallback })}
      className="guest-name-sheet" size="sm" dismissable={false}>
      <form className="guest-fields" onSubmit={event => { event.preventDefault(); renameSelf(shown); }}>
        <Input autoFocus label={t("guest.name")} autoComplete="nickname" maxLength={80} placeholder={fallback}
          value={name} onChange={event => setName(event.currentTarget.value)} />
        <div className="guest-preview" aria-hidden="true">
          <Icon name="cursor" size={22} />
          <strong>{shown}</strong>
          <span>{t("guest.preview")}</span>
        </div>
        <GuestNameNotice />
        <Button className="signup-submit" variant="primary" type="submit">{t("guest.enter")}</Button>
      </form>
    </Dialog>
  );
}
