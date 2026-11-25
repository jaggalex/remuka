import {
  addColumn,
  setColumnAccent,
  addSwimlane,
  deleteColumn,
  deleteSwimlane,
  deleteWidgets,
  moveColumn,
  moveSwimlane,
  setCardFill,
  type BoardDocument,
} from "@remo/doc";
import { setSectionView } from "./sectionView";
import { openSectionLayout } from "./sectionLayoutStore";
import { openKanbanTitleEdit } from "./kanbanTitleEditStore";
import {
  FILL_LEVELS,
  cardFillFor,
  type ColorLevel,
  type KanbanState,
  type Widget,
  type WidgetType,
} from "@remo/model";
import type { ContextTarget } from "./BoardCanvas";
import type { MenuGrid, MenuItem, MenuState } from "./ContextMenu";
import {
  COMMAND_GROUPS,
  SEARCH_IN_CONTEXT_MENU,
  commandsFor,
  paletteChoices,
  registryCommand,
  runCommand,
  shortcutLabel,
  type Command,
  type CommandContext,
} from "./commands";
import type { TranslationKey } from "./i18n";

export interface BoardMenuResult {
  menu: MenuState | null;
  /** Objects the click selects; a card right-click is also a selection. */
  select: string[] | null;
  /** The click point, for a command that needs it (Info, paste). */
  point: { x: number; y: number } | null;
}

/**
 * The one-word name of what was right-clicked, for the menu's title (ADR-267 §3).
 *
 * The title names the target, not the command, which is why it lives here and not in
 * the registry: the same commands appear over a note, a shape and a multi-selection.
 */
const OBJECT_TITLE: Partial<Record<WidgetType, TranslationKey>> = {
  sticky_note: "tool.sticky",
  shape: "tool.shape",
  text: "tool.text",
  connector: "tool.connector",
  frame: "tool.frame",
  image: "tool.image",
  timer: "ds.timer",
  kanban: "canvas.kanban",
  card: "menu.card",
  group: "canvas.group",
};

/** What the menu calls its target, e.g. "Sticky note" or "Table". */
function objectTitle(widget: Widget): TranslationKey {
  const table =
    widget.type === "frame" && widget.layout?.kind === "table" && widget.layout.active !== false;
  if (table) return "section.view.table";
  return OBJECT_TITLE[widget.type] ?? "menu.object";
}

/** A row that opens a colour grid, built from the palette's own words (ADR-127). */
function paletteRow({
  title,
  levels,
  current,
  pick,
  reset,
  t,
}: {
  title: TranslationKey;
  levels: readonly ColorLevel[];
  current: string;
  pick: (value: string) => void;
  reset?: MenuGrid["reset"];
  t: (key: TranslationKey) => string;
}): MenuItem {
  return {
    label: t(title),
    icon: "palette",
    grid: {
      title: t(title),
      // Seven columns per row, in the model's order: the same grid the colour window
      // and the column menu draw, only reached from a row (ADR-267 §3).
      choices: paletteChoices(levels).map((choice) => ({
        value: choice.value,
        label: t(choice.label),
      })),
      current: current.toLowerCase(),
      pick,
      reset,
    },
  };
}

/**
 * One registry command as a menu row (ADR-050, ADR-267 §3).
 *
 * The row reads `group`, `icon`, `shortcut` and `grid` from the command; nothing here
 * knows which action it is. A grid command with no grid for this target (a text object
 * has no fill) is left out rather than shown dead.
 */
function commandRow(
  command: Command,
  context: CommandContext,
  t: (key: TranslationKey) => string,
): MenuItem | null {
  const grid = command.grid?.(context) ?? null;
  if (command.grid && !grid) return null;
  return {
    commandId: command.id,
    label: t(command.label(context) as TranslationKey),
    icon: command.icon,
    shortcut: command.shortcut ? shortcutLabel(command.shortcut) : undefined,
    danger: command.danger,
    disabled: !command.enabled(context),
    action: grid
      ? undefined
      : () => {
          runCommand(command, context);
        },
    grid: grid
      ? {
          title: t(grid.title),
          choices: grid.choices.map((choice) => ({
            value: choice.value,
            label: t(choice.label),
          })),
          current: grid.current,
          pick: grid.pick,
          reset: grid.reset
            ? {
                label: t(grid.reset.label),
                active: grid.reset.active,
                pick: grid.reset.pick,
              }
            : undefined,
        }
      : undefined,
  };
}

/**
 * "Find an action ⌘K" — the row that opens the search (T6, T7).
 *
 * It is a chrome command: the account menu offers the same id. The row is built here
 * because the canvas menu is not a chrome menu, and the action ignores this context.
 */
function searchMenuItem(t: (key: TranslationKey) => string): MenuItem | null {
  if (!SEARCH_IN_CONTEXT_MENU) return null;
  const search = registryCommand("search.open");
  const chrome = search && "title" in search ? search : null;
  if (!chrome) return null;
  return {
    commandId: chrome.id,
    label: t(chrome.title),
    icon: chrome.icon,
    shortcut: chrome.shortcut,
    action: () => chrome.run({ can: {}, run: () => undefined }),
  };
}

/**
 * The canvas context menu for whatever was right-clicked.
 *
 * A pure builder: it decides which items exist, in what order and whether they are
 * enabled, and hands the answer back to App. The menu therefore cannot mutate the
 * document on its own, and the selection menu is the command list itself — same rows,
 * same enablement, same run as the keyboard and the panel (ADR-050). Rows are grouped
 * by the command's own `group`, so the order main → clipboard → arrange → danger is a
 * property of the registry rather than a list kept beside it (ADR-267 §3).
 */
export function buildBoardMenu({
  target,
  point,
  board,
  kanbanStates,
  commandContext,
  writeBlocked,
  copyIds,
  duplicateIds,
  pasteSelection,
  count,
  t,
  onNotice,
}: {
  target: ContextTarget;
  point: { x: number; y: number; world: { x: number; y: number } };
  board: BoardDocument;
  kanbanStates: Record<string, KanbanState>;
  commandContext: CommandContext;
  writeBlocked: boolean;
  copyIds: (ids: string[]) => Promise<boolean>;
  duplicateIds: (ids: string[]) => void;
  pasteSelection: (at?: { x: number; y: number }) => Promise<void>;
  /** Russian's three counted forms: "1 объект / 3 объекта" (ADR-265 §2). */
  count?: (key: "objects", n: number) => string;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
  onNotice?: (text: string) => void;
}): BoardMenuResult {
  const result: BoardMenuResult = { menu: null, select: null, point: null };
  /** Every branch below sets the menu; the helper keeps that a single assignment. */
  const menu = (state: MenuState | null) => {
    result.menu = state;
  };
  const { x, y } = point;

  if (target.kind === "column") {
    const state = kanbanStates[target.kanbanId];
    if (!state) return result;
    const column = state.columns[target.index];
    menu({
      x,
      y,
      title: t("menu.column", { title: column?.title ?? "" }),
      groups: [
        [
          {
            // The same field a double click on the title opens, on the kanban (ADR-244).
            label: t("menu.renameColumn"),
            icon: "pencil",
            action: () =>
              openKanbanTitleEdit({ kanbanId: target.kanbanId, kind: "column", id: target.columnId }),
            disabled: writeBlocked,
          },
          paletteRow({
            title: "menu.columnColor",
            // The bright fill row and the line row: a row-600 accent changes only the
            // header's colour, the cards still read the 300 fill (ADR-267 §2.1).
            levels: [300, 600],
            current: column?.accent ?? "",
            pick: (value) => setColumnAccent(board, target.kanbanId, target.columnId, value),
            t,
          }),
        ],
        [
          {
            label: t("menu.addColumnRight"),
            icon: "plus",
            action: () => addColumn(board, target.kanbanId, t("menu.newColumn"), target.index + 1),
          },
          {
            label: t("menu.moveLeft"),
            icon: "undo",
            action: () => moveColumn(board, target.kanbanId, target.columnId, target.index - 1),
            disabled: target.index === 0,
          },
          {
            label: t("menu.moveRight"),
            icon: "redo",
            action: () => moveColumn(board, target.kanbanId, target.columnId, target.index + 1),
            disabled: target.index >= state.columns.length - 1,
          },
        ],
        [
          {
            label: t("menu.deleteColumn"),
            icon: "trash",
            action: () => deleteColumn(board, target.kanbanId, target.columnId),
            disabled: state.columns.length <= 1,
            danger: true,
          },
        ],
      ],
    });
    return result;
  }

  if (target.kind === "swimlane") {
    const state = kanbanStates[target.kanbanId];
    if (!state) return result;
    const lane = state.swimlanes[target.index];
    menu({
      x,
      y,
      title: t("menu.swimlane", { title: lane?.title ?? "" }),
      groups: [
        [
          {
            label: t("menu.renameSwimlane"),
            icon: "pencil",
            action: () =>
              openKanbanTitleEdit({ kanbanId: target.kanbanId, kind: "lane", id: target.swimlaneId }),
            disabled: writeBlocked,
          },
        ],
        [
          {
            label: t("menu.addSwimlaneBelow"),
            icon: "plus",
            action: () =>
              addSwimlane(board, target.kanbanId, t("menu.newSwimlane"), target.index + 1),
          },
          {
            label: t("menu.moveUp"),
            icon: "layer-up",
            action: () =>
              moveSwimlane(board, target.kanbanId, target.swimlaneId, target.index - 1),
            disabled: target.index === 0,
          },
          {
            label: t("menu.moveDown"),
            icon: "layer-down",
            action: () =>
              moveSwimlane(board, target.kanbanId, target.swimlaneId, target.index + 1),
            disabled: target.index >= state.swimlanes.length - 1,
          },
        ],
        [
          {
            label: t("menu.deleteSwimlane"),
            icon: "trash",
            action: () => deleteSwimlane(board, target.kanbanId, target.swimlaneId),
            disabled: state.swimlanes.length <= 1,
            danger: true,
          },
        ],
      ],
    });
    return result;
  }

  if (target.kind === "card") {
    result.select = [target.cardId];
    result.point = { x, y };
    // The card's own colour, or the column's when it has none (ADR-267 §2.1). The grid
    // offers the two fill rows; "same as column" clears the card's own value and lets the
    // column paint it again.
    const state = kanbanStates[target.kanbanId];
    const columnId = state?.cards[target.cardId]?.columnId;
    const accent = state?.columns.find((column) => column.id === columnId)?.accent;
    const own = board.readWidget(target.cardId)?.style?.fillColor;
    menu({
      x,
      y,
      title: t("menu.card"),
      groups: [
        [
          {
            label: t("menu.copy"),
            icon: "copy",
            shortcut: "⌘C",
            action: () => void copyIds([target.cardId]),
          },
          {
            label: t("menu.duplicate"),
            icon: "duplicate",
            shortcut: "⌘D",
            action: () => duplicateIds([target.cardId]),
          },
        ],
        [
          paletteRow({
            title: "menu.cardColour",
            levels: FILL_LEVELS,
            current: own ?? cardFillFor(accent),
            pick: (value) => setCardFill(board, target.cardId, value),
            reset: {
              label: t("menu.likeColumn"),
              active: !own,
              pick: () => setCardFill(board, target.cardId, null),
            },
            t,
          }),
        ],
        [
          {
            label: t("menu.deleteCard"),
            icon: "trash",
            shortcut: "Del",
            action: () => deleteWidgets(board, [target.cardId]),
            danger: true,
          },
        ],
      ],
    });
    return result;
  }

  if (target.kind === "kanban") {
    menu({
      x,
      y,
      title: t("menu.kanban"),
      groups: [
        [
          { label: t("menu.addColumn"), icon: "plus", action: () => addColumn(board, target.kanbanId) },
          {
            label: t("menu.addSwimlane"),
            icon: "plus",
            action: () => addSwimlane(board, target.kanbanId),
          },
        ],
      ],
    });
    return result;
  }

  if (target.kind === "selection" && target.ids.length) {
    // The menu is the command list: same rows, same enablement, same run as the keyboard
    // and the panel (ADR-050). Info needs the click point, which is what `menuPoint` is for.
    result.point = { x, y };
    const context: CommandContext = { ...commandContext, ids: target.ids };
    const frame = target.ids.length === 1 ? board.readWidget(target.ids[0]!) : undefined;
    const table =
      frame?.type === "frame" && frame.layout?.kind === "table" && frame.layout.active !== false;
    const readOnly = (commandId: string) =>
      commandId === "copy" ||
      commandId === "copyLink" ||
      commandId === "copyStyle" ||
      commandId === "info";

    // Keep registry order inside a group, and "Delete" last inside the danger group, so a
    // future dangerous action never pushes the familiar one off the bottom (Task T6).
    const ordered: MenuItem[][] = [];
    for (const group of COMMAND_GROUPS) {
      const groupCommands = commandsFor("menu", context).filter(
        (command) => command.group === group && (!writeBlocked || readOnly(command.id)),
      );
      const items = groupCommands
        .sort((a, b) => Number(a.id === "delete") - Number(b.id === "delete"))
        .map((command) => commandRow(command, context, t))
        .filter((row): row is MenuItem => row !== null);
      if (items.length) ordered.push(items);
    }

    const sectionItems: MenuItem[] = [];
    if (frame?.type === "frame" && !writeBlocked) {
      const locked = Boolean(frame.locked);
      const reason = locked ? ` — ${t("section.view.locked")}` : "";
      sectionItems.push(
        {
          label: `${t("section.view.toTable")}${reason}`,
          icon: "table",
          action: () => {
            if (locked) return;
            const objects = board.readWidgets().filter((widget) => widget.parentId === frame.id);
            if (!frame.layout && objects.length) openSectionLayout(frame.id);
            else setSectionView(board, frame.id, "table", t);
          },
          disabled: locked || Boolean(table),
        },
        {
          label: `${t("section.view.toFree")}${reason}`,
          icon: "frame",
          action: () => {
            if (locked) return;
            setSectionView(board, frame.id, "free", t);
            if (table) onNotice?.(t("section.view.removed"));
          },
          disabled: locked || !table,
        },
      );
    }
    // "To table" and "To free" belong to what the object is for, so they open the main
    // group rather than forming a group of their own above it.
    if (sectionItems.length) {
      if (ordered.length) ordered[0]!.unshift(...sectionItems);
      else ordered.push(sectionItems);
    }

    // The search row is its own last group before the danger group (T6, T7).
    const search = searchMenuItem(t);
    if (search) ordered.splice(Math.max(0, ordered.length - 1), 0, [search]);

    menu({
      x,
      y,
      title:
        target.ids.length === 1
          ? frame
            ? t(objectTitle(frame))
            : t("menu.object")
          : count
            ? count("objects", target.ids.length)
            : t("menu.objects", { count: target.ids.length }),
      groups: ordered,
    });
    return result;
  }

  // Empty canvas: the menu is about the board itself, and paste lands where the
  // click was rather than wherever the cascade happens to be. The search row follows,
  // as it does over a selection (spec/canvas-character.md §3).
  const search = searchMenuItem(t);
  menu({
    x,
    y,
    title: t("menu.canvas"),
    groups: [
      [
        {
          label: t("menu.paste"),
          icon: "plus",
          shortcut: "⌘V",
          action: () => void pasteSelection(point.world),
        },
      ],
      ...(search ? [[search]] : []),
    ],
  });

  return result;
}
