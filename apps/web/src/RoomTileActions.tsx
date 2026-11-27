import { useState } from "react";
import { Button, IconButton, Menu, type MenuItem } from "@remo/ui";
import type { BoardTile } from "./boardDirectory";
import { useI18n } from "./i18n";
import { useMenuFocus } from "./useMenuFocus";

export function RoomTileActions({ board, trash, onRestore, onAppearance, onDuplicate, onDelete }: {
  board: BoardTile; trash: boolean; onRestore: () => void; onAppearance: () => void;
  onDuplicate: () => void; onDelete: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const anchor = useMenuFocus(open, true);
  const item = (action: () => void) => () => { setOpen(false); action(); };
  const items: MenuItem[] = [
    { label: t("home.appearance"), icon: "image", onSelect: item(onAppearance) },
  ];
  if (board.canDuplicate) items.push({ label: t("boards.duplicate"), icon: "copy", onSelect: item(onDuplicate) });
  if (board.canDelete) items.push({ label: t("boards.delete"), icon: "trash", danger: true, onSelect: item(onDelete) });
  return (
    <span className="home-tile-menu" ref={anchor} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }}>
      {trash ? <Button size="compact" variant="secondary" onClick={onRestore}>{t("home.restore")}</Button> : <>
        <IconButton icon="more" label={t("board.menu")} size="compact" variant="ghost"
          aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} />
        {open && <Menu label={t("board.menu")} items={items} onClose={() => setOpen(false)} />}
      </>}
    </span>
  );
}
