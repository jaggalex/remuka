import type { IconName } from "@remo/ui";
import type { TranslationKey } from "./i18n";

type Target = "column" | "swimlane" | "card";
type Group = "main" | "edit" | "danger";
function entry(id: string, target: Target, group: Group, label: TranslationKey, icon: IconName) {
  return { id, target, group, label, icon };
}

/** Commands whose target is an occurrence in a kanban, rather than the canvas selection. */
export const KANBAN_COMMANDS = [
  entry("kanban.column.rename", "column", "main", "menu.renameColumn", "pencil"),
  entry("kanban.column.color", "column", "main", "menu.columnColor", "palette"),
  entry("kanban.column.wip", "column", "main", "menu.columnWip", "kanban"),
  entry("kanban.column.add", "column", "edit", "menu.addColumnRight", "plus"),
  entry("kanban.column.left", "column", "edit", "menu.moveLeft", "undo"),
  entry("kanban.column.right", "column", "edit", "menu.moveRight", "redo"),
  entry("kanban.column.delete", "column", "danger", "menu.deleteColumn", "trash"),
  entry("kanban.lane.rename", "swimlane", "main", "menu.renameSwimlane", "pencil"),
  entry("kanban.lane.add", "swimlane", "edit", "menu.addSwimlaneBelow", "plus"),
  entry("kanban.lane.up", "swimlane", "edit", "menu.moveUp", "layer-up"),
  entry("kanban.lane.down", "swimlane", "edit", "menu.moveDown", "layer-down"),
  entry("kanban.lane.delete", "swimlane", "danger", "menu.deleteSwimlane", "trash"),
  entry("kanban.card.copy", "card", "main", "menu.copy", "copy"),
  entry("kanban.card.duplicate", "card", "main", "menu.duplicate", "duplicate"),
  entry("kanban.card.color", "card", "edit", "menu.cardColour", "palette"),
  entry("kanban.card.delete", "card", "danger", "menu.deleteCard", "trash"),
];
export type KanbanCommand = (typeof KANBAN_COMMANDS)[number];
