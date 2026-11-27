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
} from "@remo/doc";
import {
  canUnlock,
  FILL_LEVELS,
  isRotatable,
  kindOf,
  lockAuthorName,
  type ColorLevel,
  type Widget,
} from "@remo/model";
import type { Command, CommandContext, CommandGrid } from "./commands";
import { paletteChoices } from "./commands";
import { commonColour } from "./floatingTargets";
import { isEditable } from "./editable";

/**
 * The object half of the command registry (ADR-050).
 *
 * One list, split out of `commands.ts` only because of the size ratchet: the types, the
 * grouping, the menu builder and every consumer stay in `commands.ts`, which re-exports
 * this list. The palette surface and the RU/EN synonyms are fields of the same
 * descriptor the menu reads, so the search cannot drift from the menu (ADR-266 §1.2).
 */

/** The colour grid a menu row opens, built from the one model table. */
function paletteGrid(
  levels: readonly ColorLevel[],
  current: string,
  pick: (value: string) => void,
): CommandGrid {
  return { title: "menu.colour", choices: paletteChoices(levels), current, pick };
}

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
    id: "editText",
    label: () => "inspector.editText",
    menuTitle: "menu.editText",
    group: "main",
    synonyms: {
      ru: ["править текст", "редактировать", "изменить текст", "писать"],
      en: ["edit text", "edit", "write", "change text"],
    },
    icon: "pencil",
    surfaces: ["menu", "panel", "palette"],
    enabled: (ctx) => singleSelected(ctx) && selectedWidgets(ctx).some(isEditable),
    unavailable: "search.notEditable",
    run: (ctx) => {
      const id = ctx.ids[0];
      if (id) ctx.editText?.(id);
    },
  },
  {
    id: "colour",
    label: () => "menu.colour",
    group: "main",
    synonyms: { ru: ["цвет", "заливка", "палитра"], en: ["colour", "color", "fill", "palette"] },
    icon: "palette",
    menuTitle: "menu.colour",
    surfaces: ["menu"],
    enabled: (ctx) => commonColour(selectedWidgets(ctx).filter((widget) => !widget.locked)) != null,
    unavailable: "search.needSelection",
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
    synonyms: { ru: ["копировать", "скопировать", "копия"], en: ["copy"] },
    icon: "copy",
    shortcut: { key: "c", mod: true },
    surfaces: ["menu", "panel", "palette"],
    enabled: hasSelection,
    unavailable: "search.needSelection",
    run: (ctx) => ctx.copy(ctx.ids),
  },
  {
    id: "paste",
    label: () => "menu.paste",
    group: "clipboard",
    synonyms: { ru: ["вставить", "вставка"], en: ["paste"] },
    icon: "plus",
    shortcut: { key: "v", mod: true, always: true },
    surfaces: ["menu", "panel", "palette"],
    enabled: () => true,
    run: (ctx) => ctx.paste(),
  },
  {
    id: "cut",
    label: () => "menu.cut",
    group: "clipboard",
    synonyms: { ru: ["вырезать", "вырезание"], en: ["cut"] },
    icon: "cut",
    shortcut: { key: "x", mod: true },
    surfaces: ["menu", "panel", "palette"],
    enabled: hasSelection,
    unavailable: "search.needSelection",
    run: (ctx) => ctx.cut(ctx.ids),
  },
  {
    id: "duplicate",
    label: () => "menu.duplicate",
    group: "clipboard",
    synonyms: { ru: ["дублировать", "копия", "размножить"], en: ["duplicate", "copy"] },
    icon: "duplicate",
    shortcut: { key: "d", mod: true },
    surfaces: ["menu", "panel", "palette"],
    enabled: hasSelection,
    unavailable: "search.needSelection",
    run: (ctx) => ctx.duplicate(ctx.ids),
  },
  {
    id: "copyLink",
    label: () => "menu.copyLink",
    group: "clipboard",
    synonyms: { ru: ["ссылка", "скопировать ссылку", "объект"], en: ["link", "copy link"] },
    icon: "link",
    surfaces: ["menu", "panel", "palette"],
    enabled: (ctx) => singleSelected(ctx) && Boolean(ctx.copyLink),
    unavailable: "search.oneObject",
    run: (ctx) => {
      const id = ctx.ids[0];
      if (id) ctx.copyLink?.(id);
    },
  },
  {
    id: "copyStyle",
    label: () => "menu.copyStyle",
    group: "clipboard",
    synonyms: { ru: ["стиль", "скопировать вид", "оформление"], en: ["style", "copy style", "look"] },
    icon: "palette",
    surfaces: ["menu", "palette"],
    enabled: hasSelection,
    unavailable: "search.needSelection",
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
    synonyms: { ru: ["стиль", "вставить вид", "оформление"], en: ["style", "paste style", "look"] },
    icon: "palette",
    surfaces: ["menu", "palette"],
    enabled: (ctx) => hasSelection(ctx) && hasStyleClipboard(ctx),
    unavailable: "search.copyStyleFirst",
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
    synonyms: { ru: ["очистить", "содержимое", "текст"], en: ["clear", "content", "text"] },
    icon: "clear-format",
    surfaces: ["menu", "palette"],
    enabled: hasSelection,
    unavailable: "search.needSelection",
    run: (ctx) => clearContent(ctx.board, ctx.ids),
  },
  {
    id: "rotate90",
    label: () => "menu.rotate90",
    group: "main",
    synonyms: { ru: ["повернуть", "поворот", "90"], en: ["rotate", "turn", "90"] },
    icon: "redo",
    surfaces: ["menu", "panel", "palette"],
    enabled: hasRotatable,
    unavailable: "search.notRotatable",
    run: (ctx) => rotateWidgets(ctx.board, ctx.ids, 90),
  },
  {
    id: "resetRotation",
    label: () => "menu.resetRotation",
    group: "main",
    synonyms: { ru: ["поворот", "сбросить", "выровнять"], en: ["rotation", "reset", "straighten"] },
    icon: "undo",
    surfaces: ["menu", "panel", "palette"],
    enabled: hasTurned,
    unavailable: "search.needTurned",
    run: (ctx) => setWidgetRotation(ctx.board, ctx.ids, 0),
  },
  {
    id: "rotateLeft15",
    label: () => "menu.rotateLeft15",
    group: "main",
    synonyms: { ru: ["повернуть", "влево", "15"], en: ["rotate", "left", "15"] },
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
    synonyms: { ru: ["повернуть", "вправо", "15"], en: ["rotate", "right", "15"] },
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
    synonyms: { ru: ["информация", "сведения", "id"], en: ["info", "details", "id"] },
    icon: "info",
    surfaces: ["menu", "panel", "palette"],
    enabled: singleSelected,
    unavailable: "search.oneObject",
    run: (ctx) => {
      const widget = ctx.widgets.find((candidate) => candidate.id === ctx.ids[0]);
      if (widget) ctx.info(widget);
    },
  },
  {
    id: "front",
    label: () => "menu.front",
    group: "arrange",
    synonyms: { ru: ["наверх", "передний план", "слой"], en: ["front", "bring to front", "layer"] },
    icon: "layer-top",
    shortcut: { key: "]", mod: true, shift: true },
    surfaces: ["menu", "panel", "palette"],
    enabled: hasSelection,
    unavailable: "search.needSelection",
    run: (ctx) => reorderWidgets(ctx.board, ctx.ids, "front"),
  },
  {
    id: "forward",
    label: () => "menu.forward",
    group: "arrange",
    synonyms: { ru: ["выше", "слой", "вперёд"], en: ["forward", "raise", "layer"] },
    icon: "layer-up",
    shortcut: { key: "]", mod: true },
    surfaces: ["menu", "panel", "palette"],
    enabled: hasSelection,
    unavailable: "search.needSelection",
    run: (ctx) => reorderWidgets(ctx.board, ctx.ids, "forward"),
  },
  {
    id: "backward",
    label: () => "menu.backward",
    group: "arrange",
    synonyms: { ru: ["ниже", "слой", "назад"], en: ["backward", "lower", "layer"] },
    icon: "layer-down",
    shortcut: { key: "[", mod: true },
    surfaces: ["menu", "panel", "palette"],
    enabled: hasSelection,
    unavailable: "search.needSelection",
    run: (ctx) => reorderWidgets(ctx.board, ctx.ids, "backward"),
  },
  {
    id: "back",
    label: () => "menu.back",
    group: "arrange",
    synonyms: { ru: ["вниз", "задний план", "слой"], en: ["back", "send to back", "layer"] },
    icon: "layer-bottom",
    shortcut: { key: "[", mod: true, shift: true },
    surfaces: ["menu", "panel", "palette"],
    enabled: hasSelection,
    unavailable: "search.needSelection",
    run: (ctx) => reorderWidgets(ctx.board, ctx.ids, "back"),
  },
  {
    id: "lock",
    label: (ctx) => (allLocked(ctx) ? "menu.unlock" : "menu.lock"),
    group: "arrange",
    synonyms: { ru: ["закрепить", "открепить", "блокировать"], en: ["lock", "unlock", "freeze"] },
    icon: "lock",
    shortcut: { key: "l", mod: true, shift: true },
    surfaces: ["menu", "panel", "palette"],
    enabled: hasSelection,
    unavailable: "search.needSelection",
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
    synonyms: { ru: ["открепить", "снять блокировку", "все"], en: ["unlock", "release", "all"] },
    icon: "unlock",
    surfaces: ["menu", "palette"],
    // The caller's own locks, plus everything when the caller is a board manager.
    enabled: (ctx) =>
      ctx.widgets.some(
        (widget) => widget.locked && canUnlock(widget, ctx.actor.id, ctx.canManage),
      ),
    unavailable: "search.nothingLocked",
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
    synonyms: { ru: ["упорядочить", "прибрать", "порядок"], en: ["tidy", "arrange", "order"] },
    icon: "tidy",
    surfaces: ["menu", "panel", "palette"],
    enabled: (ctx) => hasSelection(ctx) && Boolean(ctx.tidy),
    unavailable: "search.needSelection",
    run: (ctx) => ctx.tidy?.(ctx.ids),
  },
  {
    id: "group",
    label: () => "menu.group",
    group: "arrange",
    synonyms: { ru: ["сгруппировать", "группа", "объединить"], en: ["group", "combine"] },
    icon: "group-make",
    shortcut: { key: "g", mod: true, always: true },
    surfaces: ["menu", "panel", "palette"],
    enabled: isGroupable,
    unavailable: "search.needTwo",
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
    synonyms: { ru: ["разгруппировать", "разъединить"], en: ["ungroup", "separate"] },
    icon: "group-break",
    shortcut: { key: "g", mod: true, shift: true, always: true },
    surfaces: ["menu", "panel", "palette"],
    enabled: selectionHasGroup,
    unavailable: "search.notGrouped",
    run: (ctx) => ungroupWidgets(ctx.board, [...ctx.ids]),
  },
  {
    id: "delete",
    label: () => "menu.delete",
    group: "danger",
    synonyms: { ru: ["удалить", "стереть", "убрать"], en: ["delete", "remove", "erase"] },
    icon: "trash",
    shortcut: { key: ["backspace", "delete"] },
    surfaces: ["menu", "panel", "palette"],
    danger: true,
    enabled: hasSelection,
    unavailable: "search.needSelection",
    run: (ctx) => {
      if (ctx.deleteSelection) ctx.deleteSelection(ctx.ids);
      else {
        deleteWidgets(ctx.board, [...ctx.ids]);
        ctx.select([]);
      }
    },
  },
];

