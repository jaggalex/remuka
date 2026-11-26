import { expect, it } from "vitest";
import { BoardDocument, createSticky } from "@remo/doc";
import { canUndoDraft, draftUndoAfterWrite } from "./draftUndo";

it("an empty write cannot claim an earlier human edit", () => {
  const board = new BoardDocument();
  createSticky(board, "human", { x: 0, y: 0 });
  const before = board.undo.undoStack.at(-1);
  expect(draftUndoAfterWrite(board.undo, "task", before)).toBeUndefined();
});

it("only the same task, board and topmost local write can be undone", () => {
  const board = new BoardDocument();
  const otherBoard = new BoardDocument();
  createSticky(board, "human", { x: 0, y: 0 });
  const before = board.undo.undoStack.at(-1);
  board.undo.stopCapturing();
  createSticky(board, "agent", { x: 0, y: 0 });
  const draft = draftUndoAfterWrite(board.undo, "task", before);
  board.undo.stopCapturing();
  expect(canUndoDraft(board.undo, "task", draft)).toBe(true);
  expect(canUndoDraft(board.undo, "other-task", draft)).toBe(false);
  expect(canUndoDraft(otherBoard.undo, "task", draft)).toBe(false);
  createSticky(board, "later", { x: 0, y: 0 });
  expect(canUndoDraft(board.undo, "task", draft)).toBe(false);
  board.undo.undo();
  expect(canUndoDraft(board.undo, "task", draft)).toBe(true);
  board.undo.clear();
  expect(canUndoDraft(board.undo, "task", draft)).toBe(false);
});
