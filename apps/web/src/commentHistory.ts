import type { BoardDocument } from "@remo/doc";

interface PinEdit { checkpoint: unknown; replay: (reverse: boolean) => Promise<void> }
interface History { past: PinEdit[]; future: PinEdit[]; busy: boolean; version: number; listeners: Set<() => void> }
const boards = new WeakMap<BoardDocument, History>();
function history(board: BoardDocument) {
  let state = boards.get(board);
  if (!state) {
    state = { past: [], future: [], busy: false, version: 0, listeners: new Set() };
    boards.set(board, state);
  }
  return state;
}
function changed(state: History) {
  state.version++;
  for (const handler of state.listeners) handler();
}
export function subscribePinHistory(board: BoardDocument, handler: () => void) {
  const listeners = history(board).listeners;
  listeners.add(handler);
  return () => { listeners.delete(handler); };
}
export const pinHistoryVersion = (board: BoardDocument) => history(board).version;

/** Pin edits live in SQL and have no Yjs undo entry. The current local CRDT step keeps the two histories in order. */
export function recordPinMove(board: BoardDocument, replay: PinEdit["replay"]) {
  const state = history(board);
  board.undo.stopCapturing();
  state.past.push({ checkpoint: board.undo.undoStack.at(-1), replay });
  state.future.length = 0;
  changed(state);
}
export function hasPinHistory(board: BoardDocument, redo: boolean) {
  const state = history(board);
  const entry = (redo ? state.future : state.past).at(-1);
  return !!entry && entry.checkpoint === board.undo.undoStack.at(-1);
}
export function replayPin(board: BoardDocument, redo: boolean) {
  const state = history(board);
  if (state.busy) return true;
  if (!hasPinHistory(board, redo)) return false;
  const stack = redo ? state.future : state.past;
  const entry = stack.pop()!;
  state.busy = true;
  void entry.replay(!redo).then(() => {
    (redo ? state.past : state.future).push(entry);
  }).catch(failure => {
    // A peer may already have moved the same pin. Retrying must not overwrite their move.
    if (![403, 404, 409].includes(failure?.status)) stack.push(entry);
  }).finally(() => { state.busy = false; changed(state); });
  changed(state);
  return true;
}
