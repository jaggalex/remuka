import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { Badge, Button, Menu, type MenuItem } from "@remo/ui";
import { useI18n } from "../i18n";
import type { RoomMenuRows } from "./registryItems";

/**
 * The board's name, and everything that acts on the board as a document (ADR-119).
 *
 * The title is a button with a menu, not a text field: renaming is one item among
 * settings, export, restore, a copy and the trash. The field appears in place only while
 * renaming, so the name still reads as a name the rest of the time
 * (ADR-119, Ш1).
 */
export function BoardTitleMenu({
  title, icon, unreadCount, unreadLabel,
  path,
  pathHref,
  renaming,
  draft,
  onDraft,
  onCommit,
  onCancel,
  open,
  onOpen,
  items,
  readOnly,
}: {
  title: string;
  icon?: string;
  unreadCount?: number;
  unreadLabel?: string;
  pathHref?: string;
  path?: string | null;
  renaming: boolean;
  draft: string;
  onDraft: (value: string) => void;
  onCommit: (value: string) => void;
  onCancel: () => void;
  open: boolean;
  onOpen: (value: boolean) => void;
  items: RoomMenuRows;
  readOnly: boolean;
}) {
  const { t } = useI18n();
  const anchor = useRef<HTMLSpanElement>(null);
  const [level, setLevel] = useState<"main" | "more" | "propertiesAccess">("main");
  const returnTo = useRef<string | null>(null);
  const wasOpen = useRef(false);
  const back = () => {
    returnTo.current = "room." + level;
    setLevel("main");
  };

  useLayoutEffect(() => {
    if (open) {
      const selector = returnTo.current ? '[data-command="' + returnTo.current + '"]' :
        '[role^="menuitem"]:not([aria-disabled="true"]):not([data-command="room.menuBack"])';
      const target = anchor.current?.querySelector<HTMLElement>(selector);
      (target ?? anchor.current?.querySelector<HTMLElement>('[role^="menuitem"]'))?.focus();
      returnTo.current = null;
    } else if (wasOpen.current) {
      setLevel("main");
      anchor.current?.querySelector<HTMLButtonElement>(".board-title-button")?.focus();
    }
    wasOpen.current = open;
  }, [open, level]);

  const navigate = (event: KeyboardEvent<HTMLSpanElement>) => {
    if (!open || !(event.target instanceof HTMLElement) || !event.target.closest('[role="menu"]')) return;
    const id = event.target.closest<HTMLElement>("[data-command]")?.dataset.command;
    if (level !== "main" && (event.key === "ArrowLeft" || event.key === "Escape")) {
      event.preventDefault();
      event.stopPropagation();
      back();
    } else if (event.key === "ArrowRight" && (id === "room.more" || id === "room.propertiesAccess")) {
      event.preventDefault();
      event.stopPropagation();
      setLevel(id === "room.more" ? "more" : "propertiesAccess");
    }
  };
  const branch = (entry: "more" | "propertiesAccess", label: string): MenuItem => ({
    label, commandId: "room." + entry, submenu: true, onSelect: () => setLevel(entry),
  });
  const menuItems: MenuItem[] = level === "main" ? [
    ...items.rename,
    branch("propertiesAccess", t("board.propertiesAccess")),
    ...items.document,
    ...(items.more.length ? [branch("more", t("more.menu"))] : []),
    ...(items.trash.length ? [{ separator: true } as const, ...items.trash] : []),
  ] : [
    { label: t("board.menuBack"), commandId: "room.menuBack", onSelect: back },
    { separator: true },
    ...items[level],
  ];
  const shown = title || t("board.untitled");
  const input = useRef<HTMLInputElement | null>(null);

  // Ready to type, with the current name selected, the way renaming works everywhere.
  useEffect(() => {
    if (!renaming) return;
    input.current?.focus();
    input.current?.select();
  }, [renaming]);

  if (renaming && !readOnly) {
    return (
      <input
        ref={input}
        className="board-title"
        value={draft}
        maxLength={120}
        aria-label={t("board.name")}
        onChange={(event) => onDraft(event.target.value)}
        onBlur={(event) => onCommit(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            event.stopPropagation();
            onCancel();
          }
        }}
      />
    );
  }

  return (
    <span className="topbar-anchor topbar-anchor-start room-menu-anchor" ref={anchor} onKeyDownCapture={navigate}>
      {path && pathHref && (
        <span className="topbar-path"><a href={pathHref}>{path}</a> <span aria-hidden="true">›</span></span>
      )}
      <Button
        variant="ghost"
        iconEnd="chevron-down"
        className="board-title-button"
        aria-label={[`${t("board.menu")}: ${shown}`, unreadLabel].filter(Boolean).join(" · ")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => onOpen(!open)}
      >
        {unreadLabel && <Badge tone="info" icon="comment" count={unreadCount} />}
        {icon && <span aria-hidden="true">{icon} </span>}{shown}
      </Button>
      {open && (
        <Menu
          label={t(level === "more" ? "more.menu" : level === "propertiesAccess" ? "board.propertiesAccess" : "board.menu")}
          onClose={() => onOpen(false)}
          items={menuItems}
        />
      )}
    </span>
  );
}
