import {
  applyStyleSnapshot,
  clearContent,
  deleteWidgets,
  groupWidgets,
  reorderWidgets,
  rotateWidgets,
  setConnectorProps,
  setFillColor,
  setLocked,
  setWidgetRotation,
  styleSnapshotOf,
  ungroupWidgets,
  type BoardDocument,
  type StyleSnapshot,
} from "@remo/doc";
import {
  canUnlock,
  FILL_LEVELS,
  isRotatable,
  kindOf,
  lockAuthorName,
  TONE_LEVELS,
  TONES,
  type ColorLevel,
  type Widget,
} from "@remo/model";
import type { IconName } from "@remo/ui";
import type { TranslationKey } from "./i18n";
import { CHROME_COMMANDS } from "./commandsChrome";
import { colorName } from "./object-panel/colorWindowData";
import { commonColour } from "./floatingTargets";

// The chrome list lives in its own module for the size ratchet; this file remains the
// registry's public surface, so every consumer still imports one thing.
export { CHROME_COMMANDS } from "./commandsChrome";

/**
 * What can be done with the current selection (ADR-050).
 *
 * Before this list existed the same fifteen actions were written three times: as
 * context-menu items, as keyboard branches, and as buttons in the right panel — with
 * the "is it available" question answered separately in each place. The panel even had
 * its own copy of the group predicate, which is the kind of duplicate that starts
 * disagreeing the day a rule changes.
 *
 * The list is the single answer. It holds the document-level commands; the app passes
 * in the few things only it can do (clipboard, selection, opening the editor).
 */
export interface CommandContext {
  board: BoardDocument;
  widgets: readonly Widget[];
  /** The selection the command applies to. */
  ids: readonly string[];
  /** Clipboard lives in the app: it needs the system clipboard and a selection. */
  copy: (ids: readonly string[]) => void;
  cut: (ids: readonly string[]) => void;
  duplicate: (ids: readonly string[]) => void;
  /** Select these ids (grouping selects the new group, duplicate the copies). */
  select: (ids: string[]) => void;
  /** Ask for confirmation before removing these ids; the app owns the dialog. */
  deleteSelection?: (ids: readonly string[]) => void;
  /** Paste the current clipboard fragment or plain text. */
  paste: () => void;
  /** Open the Info card for one object, at the pointer. */
  info: (widget: Widget) => void;
  /** Copy a board deep link to one object (ADR-103); the app owns the URL. */
  copyLink?: (id: string) => void;
  /** Copy/paste of a look, shared across the session. */
  styleClipboard: {
    get: () => StyleSnapshot | null;
    set: (snapshot: StyleSnapshot) => void;
  };
  /** Who is acting; the author lock needs the id, not just the display name (ADR-107). */
  actor: { id: string | null; name: string };
  /** A board manager may release anyone's lock (ADR-107). */
  canManage: boolean;
  /** Explain a refusal caused by another person's lock; the app owns the notice. */
  refuseUnlock: (authorName: string) => void;
  /** Open the tidy preview for these ids; the app owns the dialog and the plan. */
  tidy?: (ids: readonly string[]) => void;
}

/** A key combination, in the shape the keydown handler can match. */
export interface Shortcut {
  /** `event.key`, lower-cased. Several keys mean "either". */
  key: string | readonly string[];
  /** ⌘ on macOS, Ctrl elsewhere. */
  mod?: boolean;
  shift?: boolean;
  /**
   * Claim the key even when the command would do nothing.
   *
   * Copy with an empty selection must fall through to the browser, but ⌘G must not
   * open the browser's "find next". That difference is a decision, so it is written
   * down per command instead of being an accident of branch order.
   */
  always?: boolean;
}

/**
 * Where a command is offered (ADR-050, ADR-266).
 *
 * `menu` and `panel` are the object surfaces. `header` is a chrome menu built by
 * intent; `palette` is the command search (T7). The registry is one list: a menu item
 * that is not here cannot be rendered.
 */
export type CommandSurface = "menu" | "panel" | "header" | "palette";

/** What a command is for, and therefore which menu it appears in (ADR-266 §1.1). */
export type CommandIntent = "invite" | "run" | "agent" | "room" | "account" | "canvas" | "help";

/**
 * The group a canvas menu row belongs to, in the order the mockup reads them
 * (ADR-267 §3): what the object is for, the clipboard, its place on the board, and
 * the one dangerous action last. A row carries its group instead of the menu holding
 * a list of ids, so adding a command cannot land it between two unrelated groups.
 */
export type CommandGroup = "main" | "clipboard" | "arrange" | "danger";

/** The groups in reading order; the danger group is always last (ADR-267 §3). */
export const COMMAND_GROUPS: readonly CommandGroup[] = ["main", "clipboard", "arrange", "danger"];

/** One swatch of a grid a command opens instead of acting at once. */
export interface CommandGridChoice {
  /** The value the command writes (a stored hex). */
  value: string;
  /** The colour's word — the same key the colour window uses (ADR-127). */
  label: TranslationKey;
}

/**
 * A submenu a menu row opens: the palette grid of ADR-267 §3.
 *
 * The grid is data on the command, not markup in the menu: the palette, the current
 * value and the document write stay in the registry, so the context menu and the
 * column menu cannot offer different swatches for the same colour.
 */
export interface CommandGrid {
  title: TranslationKey;
  choices: readonly CommandGridChoice[];
  /** The current value as lower-case hex, or "" when the selection disagrees. */
  current: string;
  pick: (value: string) => void;
  /** A named choice under the grid, e.g. "Same as the column" (ADR-267 §2.1). */
  reset?: { label: TranslationKey; active: boolean; pick: () => void };
}

/** Words people type when they mean a command, in both interface languages. */
export interface CommandSynonyms {
  ru: readonly string[];
  en: readonly string[];
}

/** What the person may do right now; the app decides, the registry only reads. */
export type ChromeAbility =
  | "rename"
  | "export"
  | "import"
  | "duplicate"
  | "delete"
  | "access"
  | "facilitate"
  | "agents"
  | "askAgents"
  | "apps"
  | "signedIn"
  | "support"
  | "templates"
  /** The installation has a guide of its own (`/config` `docs.origin`, ADR-284). */
  | "docs";

/**
 * The chrome command's world: flags it may read and the one way to run a command.
 *
 * Handlers live in the app, by id, so the menu, the palette and any future surface
 * dispatch the same action. A command never holds a callback of its own.
 */
export interface ChromeContext {
  can: Partial<Record<ChromeAbility, boolean>>;
  run: (id: string) => void;
}

export interface ChromeCommand {
  id: string;
  title: TranslationKey;
  icon?: IconName;
  synonyms: CommandSynonyms;
  intent: CommandIntent;
  surfaces: readonly CommandSurface[];
  /** Shown, not handled, here: the keymap stays the owner of the key (ADR-050). */
  shortcut?: string;
  danger?: boolean;
  /** A room with no agents or apps does not show a dead row; search still finds it. */
  hideWhenUnavailable?: boolean;
  /** Only in the account menu below 900 px, where the header hides the control. */
  narrowOnly?: boolean;
  /** Reactions are a row of faces, not menu rows, but still commands. */
  inMenu?: false;
  available: (ctx: ChromeContext) => true | { reason: TranslationKey };
  run: (ctx: ChromeContext) => void;
}

export interface Command {
  id: string;
  /** i18n key, resolved by the caller (a lock reads Lock or Unlock). */
  label: (ctx: CommandContext) => string;
  /** Which canvas-menu group the row sits in (ADR-267 §3). */
  group: CommandGroup;
  /** The 16 px icon of the row (ADR-265 §3.7). */
  icon?: IconName;
  /**
   * The title of this command's submenu, when it opens one instead of acting.
   *
   * The menu's own title is about the target ("Sticky note", "3 objects") and comes from
   * `boardMenu.ts`, because it names what was right-clicked, not what can be done.
   */
  menuTitle?: TranslationKey;
  /** The key combination that runs it, if any. */
  shortcut?: Shortcut;
  surfaces: readonly CommandSurface[];
  danger?: boolean;
  enabled: (ctx: CommandContext) => boolean;
  /**
   * A grid this row opens rather than a change it makes (ADR-267 §3). A grid row has
   * no `run`: its swatches are what write, which keeps "one descriptor, one action".
   */
  grid?: (ctx: CommandContext) => CommandGrid | null;
  run?: (ctx: CommandContext) => void;
}

/** Run what a command does; a grid row has no action of its own to run. */
export function runCommand(command: Command, ctx: CommandContext): void {
  command.run?.(ctx);
}

/**
 * The swatches of a palette grid, seven tones per row in the model's order (ADR-127).
 * The object menu and the bespoke column and card menus both read this.
 */
export function paletteChoices(levels: readonly ColorLevel[]): CommandGridChoice[] {
  return levels.flatMap((level) =>
    TONES.map((tone) => {
      const value = TONE_LEVELS[tone][level as 100 | 300 | 600];
      return { value, label: colorName(value).key };
    }),
  );
}

/** The colour grid a menu row opens, built from the one model table. */
function paletteGrid(
  levels: readonly ColorLevel[],
  current: string,
  pick: (value: string) => void,
): CommandGrid {
  return { title: "menu.colour", choices: paletteChoices(levels), current, pick };
}

/**
 * The key shown at the right of a menu row (ADR-267 §3).
 *
 * The product's help and copy already speak ⌘ on every platform, so the menu does too:
 * a second spelling here would make the row disagree with the page it links to.
 */
export function shortcutLabel(shortcut: Shortcut): string {
  const keys = typeof shortcut.key === "string" ? [shortcut.key] : shortcut.key;
  const key = keys[0] ?? "";
  const named: Record<string, string> = {
    arrowleft: "←",
    arrowright: "→",
    arrowup: "↑",
    arrowdown: "↓",
    backspace: "Del",
    delete: "Del",
    enter: "Enter",
    " ": "Space",
  };
  const name = named[key] ?? (key.length === 1 ? key.toUpperCase() : key);
  return `${shortcut.shift ? "⇧" : ""}${shortcut.mod ? "⌘" : ""}${name}`;
}

/**
 * "Find an action ⌘K" belongs to T7 (ADR-266 §1.2): the search surface does not exist
 * yet, so the row stays hidden; T7 registers `search.open` and flips this constant.
 */
export const SEARCH_IN_CONTEXT_MENU = false;

/* ------------------------------------------------------------- predicates --- */

export const hasSelection = (ctx: CommandContext): boolean => ctx.ids.length > 0;

export const singleSelected = (ctx: CommandContext): boolean => ctx.ids.length === 1;

/** Every selected object that is not already inside a selected container. */
function groupRoots(ctx: CommandContext): Widget[] {
  const selected = new Set(ctx.ids);
  return ctx.ids
    .map((id) => ctx.widgets.find((widget) => widget.id === id))
    .filter((widget): widget is Widget => Boolean(widget))
    .filter((widget) => {
      if (!kindOf(widget.type).groupable) return false;
      return !widget.parentId || !selected.has(widget.parentId);
    });
}

/** Two or more roots can become one group (ADR-022). */
export function isGroupable(ctx: CommandContext): boolean {
  return groupRoots(ctx).length >= 2;
}

/** Something in the selection already belongs to a group. */
export function selectionHasGroup(ctx: CommandContext): boolean {
  return ctx.widgets.some((widget) => ctx.ids.includes(widget.id) && Boolean(widget.groupId));
}

function selectedWidgets(ctx: CommandContext): Widget[] {
  return ctx.ids
    .map((id) => ctx.widgets.find((widget) => widget.id === id))
    .filter((widget): widget is Widget => Boolean(widget));
}

function allLocked(ctx: CommandContext): boolean {
  const selected = selectedWidgets(ctx);
  return selected.length > 0 && selected.every((widget) => widget.locked);
}

/** The first selected lock this person may not release, if any (ADR-107). */
function foreignLock(ctx: CommandContext): Widget | null {
  return (
    selectedWidgets(ctx).find(
      (widget) =>
        widget.locked && !canUnlock(widget, ctx.actor.id, ctx.canManage),
    ) ?? null
  );
}

const hasStyleClipboard = (ctx: CommandContext): boolean => ctx.styleClipboard.get() != null;

/** At least one selected object is a kind whose angle means something (ADR-271). */
function hasRotatable(ctx: CommandContext): boolean {
  return selectedWidgets(ctx).some((widget) => isRotatable(widget) && !widget.locked);
}

/** At least one selected object is actually turned, so a reset would do something. */
function hasTurned(ctx: CommandContext): boolean {
  return selectedWidgets(ctx).some((widget) => isRotatable(widget) && !widget.locked && (widget.rotation ?? 0) !== 0);
}

/* --------------------------------------------------------------- commands --- */

export const COMMANDS: readonly Command[] = [
  {
    id: "colour",
    label: () => "menu.colour",
    group: "main",
    icon: "palette",
    menuTitle: "menu.colour",
    surfaces: ["menu"],
    enabled: (ctx) => commonColour(selectedWidgets(ctx).filter((widget) => !widget.locked)) != null,
    grid: (ctx) => {
      const selected = selectedWidgets(ctx).filter((widget) => !widget.locked);
      const common = commonColour(selected);
      if (!common) return null;
      const current = common.mixed ? "" : common.value.toLowerCase();
      // The same rows the colour window draws for this role: fills take 100 and 300,
      // a line takes 600 (ADR-127). A second palette here would be a second truth.
      if (common.role === "fill") {
        return paletteGrid(FILL_LEVELS, current, (value) =>
          setFillColor(ctx.board, ctx.ids, value),
        );
      }
      return paletteGrid([600], current, (value) =>
        setConnectorProps(ctx.board, ctx.ids, { strokeColor: value }),
      );
    },
  },
  {
    id: "copy",
    label: () => "menu.copy",
    group: "clipboard",
    icon: "copy",
    shortcut: { key: "c", mod: true },
    surfaces: ["menu", "panel"],
    enabled: hasSelection,
    run: (ctx) => ctx.copy(ctx.ids),
  },
  {
    id: "paste",
    label: () => "menu.paste",
    group: "clipboard",
    icon: "plus",
    shortcut: { key: "v", mod: true, always: true },
    surfaces: ["menu", "panel"],
    enabled: () => true,
    run: (ctx) => ctx.paste(),
  },
  {
    id: "cut",
    label: () => "menu.cut",
    group: "clipboard",
    icon: "cut",
    shortcut: { key: "x", mod: true },
    surfaces: ["menu", "panel"],
    enabled: hasSelection,
    run: (ctx) => ctx.cut(ctx.ids),
  },
  {
    id: "duplicate",
    label: () => "menu.duplicate",
    group: "clipboard",
    icon: "duplicate",
    shortcut: { key: "d", mod: true },
    surfaces: ["menu", "panel"],
    enabled: hasSelection,
    run: (ctx) => ctx.duplicate(ctx.ids),
  },
  {
    id: "copyLink",
    label: () => "menu.copyLink",
    group: "clipboard",
    icon: "link",
    surfaces: ["menu", "panel"],
    enabled: (ctx) => singleSelected(ctx) && Boolean(ctx.copyLink),
    run: (ctx) => {
      const id = ctx.ids[0];
      if (id) ctx.copyLink?.(id);
    },
  },
  {
    id: "copyStyle",
    label: () => "menu.copyStyle",
    group: "clipboard",
    icon: "palette",
    surfaces: ["menu"],
    enabled: hasSelection,
    run: (ctx) => {
      const first = ctx.ids[0];
      if (!first) return;
      const snapshot = styleSnapshotOf(ctx.board, first);
      if (snapshot) ctx.styleClipboard.set(snapshot);
    },
  },
  {
    id: "pasteStyle",
    label: () => "menu.pasteStyle",
    group: "clipboard",
    icon: "palette",
    surfaces: ["menu"],
    enabled: (ctx) => hasSelection(ctx) && hasStyleClipboard(ctx),
    run: (ctx) => {
      const snapshot = ctx.styleClipboard.get();
      // Locked objects refuse the change inside the document command (ADR-040).
      if (snapshot) applyStyleSnapshot(ctx.board, ctx.ids, snapshot);
    },
  },
  {
    id: "clearContent",
    label: () => "menu.clearContent",
    group: "main",
    icon: "clear-format",
    surfaces: ["menu"],
    enabled: hasSelection,
    run: (ctx) => clearContent(ctx.board, ctx.ids),
  },
  {
    id: "rotate90",
    label: () => "menu.rotate90",
    group: "main",
    icon: "redo",
    surfaces: ["menu", "panel", "palette"],
    enabled: hasRotatable,
    run: (ctx) => rotateWidgets(ctx.board, ctx.ids, 90),
  },
  {
    id: "resetRotation",
    label: () => "menu.resetRotation",
    group: "main",
    icon: "undo",
    surfaces: ["menu", "panel", "palette"],
    enabled: hasTurned,
    run: (ctx) => setWidgetRotation(ctx.board, ctx.ids, 0),
  },
  {
    id: "rotateLeft15",
    label: () => "menu.rotateLeft15",
    group: "main",
    icon: "undo",
    shortcut: { key: "arrowleft", mod: true, shift: true },
    surfaces: [],
    enabled: hasRotatable,
    run: (ctx) => rotateWidgets(ctx.board, ctx.ids, -15),
  },
  {
    id: "rotateRight15",
    label: () => "menu.rotateRight15",
    group: "main",
    icon: "redo",
    shortcut: { key: "arrowright", mod: true, shift: true },
    surfaces: [],
    enabled: hasRotatable,
    run: (ctx) => rotateWidgets(ctx.board, ctx.ids, 15),
  },
  {
    id: "info",
    label: () => "menu.info",
    group: "main",
    icon: "info",
    surfaces: ["menu", "panel"],
    enabled: singleSelected,
    run: (ctx) => {
      const widget = ctx.widgets.find((candidate) => candidate.id === ctx.ids[0]);
      if (widget) ctx.info(widget);
    },
  },
  {
    id: "front",
    label: () => "menu.front",
    group: "arrange",
    icon: "layer-top",
    shortcut: { key: "]", mod: true, shift: true },
    surfaces: ["menu", "panel"],
    enabled: hasSelection,
    run: (ctx) => reorderWidgets(ctx.board, ctx.ids, "front"),
  },
  {
    id: "forward",
    label: () => "menu.forward",
    group: "arrange",
    icon: "layer-up",
    shortcut: { key: "]", mod: true },
    surfaces: ["menu", "panel"],
    enabled: hasSelection,
    run: (ctx) => reorderWidgets(ctx.board, ctx.ids, "forward"),
  },
  {
    id: "backward",
    label: () => "menu.backward",
    group: "arrange",
    icon: "layer-down",
    shortcut: { key: "[", mod: true },
    surfaces: ["menu", "panel"],
    enabled: hasSelection,
    run: (ctx) => reorderWidgets(ctx.board, ctx.ids, "backward"),
  },
  {
    id: "back",
    label: () => "menu.back",
    group: "arrange",
    icon: "layer-bottom",
    shortcut: { key: "[", mod: true, shift: true },
    surfaces: ["menu", "panel"],
    enabled: hasSelection,
    run: (ctx) => reorderWidgets(ctx.board, ctx.ids, "back"),
  },
  {
    id: "lock",
    label: (ctx) => (allLocked(ctx) ? "menu.unlock" : "menu.lock"),
    group: "arrange",
    icon: "lock",
    shortcut: { key: "l", mod: true, shift: true },
    surfaces: ["menu", "panel"],
    enabled: hasSelection,
    run: (ctx) => {
      const locked = allLocked(ctx);
      if (locked) {
        const foreign = foreignLock(ctx);
        if (foreign) {
          ctx.refuseUnlock(lockAuthorName(foreign) ?? "");
          return;
        }
      }
      setLocked(
        ctx.board,
        ctx.ids,
        !locked,
        ctx.actor.id ? { id: ctx.actor.id, name: ctx.actor.name } : null,
      );
    },
  },
  {
    id: "unlockAll",
    label: () => "lock.unlockAll",
    group: "main",
    icon: "unlock",
    surfaces: ["menu"],
    // The caller's own locks, plus everything when the caller is a board manager.
    enabled: (ctx) =>
      ctx.widgets.some(
        (widget) => widget.locked && canUnlock(widget, ctx.actor.id, ctx.canManage),
      ),
    run: (ctx) => {
      const ids = ctx.widgets
        .filter((widget) => widget.locked && canUnlock(widget, ctx.actor.id, ctx.canManage))
        .map((widget) => widget.id);
      if (ids.length) setLocked(ctx.board, ids, false);
    },
  },
  {
    id: "tidy",
    label: () => "tidy.action",
    group: "main",
    icon: "tidy",
    surfaces: ["menu", "panel"],
    enabled: (ctx) => hasSelection(ctx) && Boolean(ctx.tidy),
    run: (ctx) => ctx.tidy?.(ctx.ids),
  },
  {
    id: "group",
    label: () => "menu.group",
    group: "arrange",
    icon: "group-make",
    shortcut: { key: "g", mod: true, always: true },
    surfaces: ["menu", "panel"],
    enabled: isGroupable,
    run: (ctx) => {
      const groupId = groupWidgets(ctx.board, [...ctx.ids]);
      if (!groupId) return;
      // Select every member, so the badge and the next drag treat it as one group.
      ctx.select(
        [...ctx.board.widgets.values()]
          .filter((widget) => widget.groupId === groupId)
          .map((widget) => widget.id),
      );
    },
  },
  {
    id: "ungroup",
    label: () => "menu.ungroup",
    group: "arrange",
    icon: "group-break",
    shortcut: { key: "g", mod: true, shift: true, always: true },
    surfaces: ["menu", "panel"],
    enabled: selectionHasGroup,
    run: (ctx) => ungroupWidgets(ctx.board, [...ctx.ids]),
  },
  {
    id: "delete",
    label: () => "menu.delete",
    group: "danger",
    icon: "trash",
    shortcut: { key: ["backspace", "delete"] },
    surfaces: ["menu", "panel"],
    danger: true,
    enabled: hasSelection,
    run: (ctx) => {
      if (ctx.deleteSelection) ctx.deleteSelection(ctx.ids);
      else {
        deleteWidgets(ctx.board, [...ctx.ids]);
        ctx.select([]);
      }
    },
  },
];

/** Commands shown in a given place, in the order they should appear. */
export function commandsFor(surface: CommandSurface, ctx?: CommandContext): Command[] {
  return COMMANDS.filter(
    (command) =>
      command.surfaces.includes(surface) &&
      (surface !== "panel" || !ctx || command.enabled(ctx)),
  );
}

export function commandById(id: string): Command | undefined {
  return COMMANDS.find((command) => command.id === id);
}

/**
 * How the chrome commands are grouped inside their menu.
 *
 * A menu group is at most seven rows (ADR-265 §3.6); the names are here, once, so a
 * command added to the registry cannot land between two unrelated groups.
 */
const CHROME_GROUP: Record<string, string> = {
  "room.rename": "main",
  "room.settings": "main",
  "room.properties": "main",
  "room.access": "main",
  "room.export": "document",
  "room.restore": "document",
  "room.duplicate": "document",
  "room.copyLink": "document",
  "room.template": "add",
  "room.apps": "add",
  "room.replace": "danger",
  "room.trash": "danger",
  "run.timer": "session",
  "run.vote": "session",
  "run.presentation": "session",
  "run.follow": "session",
  "agent.open": "main",
  "agent.ask": "main",
  "agent.settings": "main",
  "invite.open": "main",
  "account.allRooms": "main",
  "header.agent": "main",
  "header.comments": "main",
  "account.theme.light": "view",
  "account.theme.dark": "view",
  "account.lang.ru": "view",
  "account.lang.en": "view",
  "account.sessions": "people",
  "account.security": "people",
  "account.org": "people",
  "account.support": "people",
  "account.help": "help",
  "account.cookies": "help",
  "account.documents": "help",
  "account.docs": "help",
  "account.signOut": "session",
  "account.signIn": "session",
  "account.delete": "danger",
};

const GROUP_ORDER: Record<CommandIntent, readonly string[]> = {
  invite: ["main"],
  run: ["session", "reactions"],
  agent: ["main"],
  room: ["main", "document", "add", "danger"],
  account: ["main", "view", "people", "help", "session", "danger"],
  canvas: ["main"],
  help: ["main"],
};

/** The group a command belongs to; reactions keep their own row. */
export function commandGroup(command: ChromeCommand): string {
  if (command.inMenu === false) return "reactions";
  return CHROME_GROUP[command.id] ?? "main";
}

/** Chrome commands for one intent, in registry order. */
export function chromeCommandsFor(
  intent: CommandIntent,
  options: { narrow?: boolean } = {},
): ChromeCommand[] {
  return CHROME_COMMANDS.filter(
    (command) =>
      command.intent === intent &&
      command.surfaces.includes("header") &&
      (options.narrow || !command.narrowOnly),
  );
}

/**
 * What a menu shows: the intent's commands, minus dead rows and minus the hidden
 * availability ones. Separators are presentation and are inserted by the menu.
 */
export function menuCommands(
  intents: readonly CommandIntent[],
  ctx: ChromeContext,
  options: { narrow?: boolean; includeUnavailable?: boolean } = {},
): ChromeCommand[] {
  const order = [...new Set(intents.flatMap((intent) => GROUP_ORDER[intent]))];
  const rank = (command: ChromeCommand) => {
    const index = order.indexOf(commandGroup(command));
    return index === -1 ? order.length : index;
  };
  return intents
    .flatMap((intent) => chromeCommandsFor(intent, options))
    .filter((command) => command.inMenu !== false)
    .filter((command) => {
      const available = command.available(ctx);
      if (available === true) return true;
      if (command.hideWhenUnavailable) return false;
      return options.includeUnavailable !== false;
    })
    .sort((a, b) => rank(a) - rank(b));
}

/** The reaction row is commands too, so the menu and the search stay one list. */
export function reactionCommands(): ChromeCommand[] {
  return CHROME_COMMANDS.filter((command) => command.inMenu === false);
}

/** One registry entry by id, object or chrome. */
export function registryCommand(id: string): Command | ChromeCommand | undefined {
  return commandById(id) ?? CHROME_COMMANDS.find((command) => command.id === id);
}

/** The command that owns this key press, or null. */
export function commandForShortcut(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey">,
  ctx: CommandContext,
): Command | null {
  const key = event.key.toLowerCase();
  const mod = event.metaKey || event.ctrlKey;

  for (const command of COMMANDS) {
    const shortcut = command.shortcut;
    if (!shortcut) continue;
    if (Boolean(shortcut.mod) !== mod) continue;
    if (Boolean(shortcut.shift) !== event.shiftKey) continue;
    const keys = typeof shortcut.key === "string" ? [shortcut.key] : shortcut.key;
    if (!keys.includes(key)) continue;
    if (!shortcut.always && !command.enabled(ctx)) continue;
    return command;
  }
  return null;
}
