import type { MenuItem } from "@remo/ui";
import {
  commandGroup,
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
