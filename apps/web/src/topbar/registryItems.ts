import type { MenuItem } from "@remo/ui";
import {
  commandGroup,
  menuCommands,
  type ChromeCommand,
  type ChromeContext,
} from "../commands";
import type { TranslationKey } from "../i18n";

/**
 * Turn registry commands into menu rows.
 *
 * The only place a chrome menu is made: the room, Run, Agent and account menus all
 * come through here, so a row without a `commandId` cannot appear. A separator is
 * inserted when the group changes; unavailable rows are disabled and say why (T7
 * searches the same list with the same reasons).
 */
export function menuItemsFrom(
  commands: readonly ChromeCommand[],
  ctx: ChromeContext,
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string,
  checked: (id: string) => boolean = () => false,
): MenuItem[] {
  const items: MenuItem[] = [];
  let group: string | null = null;
  for (const command of commands) {
    const next = commandGroup(command);
    if (group !== null && next !== group) items.push({ separator: true });
    group = next;
    const available = command.available(ctx);
    items.push({
      label: t(command.title),
      icon: command.icon,
      shortcut: command.shortcut ? [command.shortcut] : undefined,
      checked: checked(command.id) ? true : undefined,
      disabled: available !== true,
      hint: available !== true ? t(available.reason) : undefined,
      danger: command.danger,
      commandId: command.id,
      onSelect: () => command.run(ctx),
    });
  }
  return items;
}

const ROOM_PRIMARY = ["room.rename", "room.properties", "room.access", "room.export", "room.copyLink", "room.trash"];

/** Each action uses the same capability and handler as its command-palette entry (ADR-309). */
export function roomMenuRows(
  ctx: ChromeContext,
  t: Parameters<typeof menuItemsFrom>[2],
  unreadLabel: string | undefined,
  commentsOpen: boolean,
  formats: { png: boolean; pdf: boolean; backup: boolean },
) {
  const commands = menuCommands(["room"], ctx);
  const rows = (...ids: string[]) => menuItemsFrom(commands.filter(command => ids.includes(command.id)), ctx, t);
  const formatNames = [formats.png && "PNG", formats.png && formats.pdf && "PDF", formats.backup && t("board.menuBackup")]
    .filter(Boolean).join(" · ");
  const titled = (id: string, label: string) => rows(id).map(item => "label" in item ? { ...item, label } : item);
  const additional = commands.filter(command => !ROOM_PRIMARY.includes(command.id));
  const more = menuItemsFrom(additional, ctx, t).map(item =>
    "commandId" in item && item.commandId === "header.comments"
      ? { ...item, label: unreadLabel ?? item.label, checked: commentsOpen }
      : item);
  return {
    rename: rows("room.rename"),
    propertiesAccess: rows("room.properties", "room.access"),
    document: [
      ...titled("room.export", t("board.menuExport", { formats: formatNames })),
      ...titled("room.copyLink", t("board.menuCopyLink")),
    ],
    more,
    trash: titled("room.trash", t("board.menuTrash")),
  };
}

export type RoomMenuRows = ReturnType<typeof roomMenuRows>;
