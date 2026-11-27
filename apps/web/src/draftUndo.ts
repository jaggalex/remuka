import type { BoardDocument } from "@remo/doc";

type Manager = BoardDocument["undo"];
type StackItem = Manager["undoStack"][number];

export interface DraftUndo {
  manager: Manager;
  taskId: string;
  item: StackItem;
}

/** An empty write cannot lend the previous edit to the draft's Undo button. */
export function draftUndoAfterWrite(manager: Manager, taskId: string, previous?: StackItem) {
  const item = manager.undoStack.at(-1);
  return item && item !== previous ? { manager, taskId, item } : undefined;
}

export function canUndoDraft(manager: Manager | undefined, taskId: string, draft?: DraftUndo) {
  return Boolean(draft && manager === draft.manager && taskId === draft.taskId &&
    manager.undoStack.at(-1) === draft.item);
}
