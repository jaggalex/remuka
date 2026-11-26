import { useCallback, useState, useSyncExternalStore } from "react";
import { hasPinHistory, pinHistoryVersion, replayPin, subscribePinHistory } from "./commentHistory";
import type { BoardDocument } from "@remo/doc";

/**
 * Undo and redo for the rail (ADR-119).
 *
 * The document owns the stacks; this hook only makes React repaint, because a rail
 * button is outside the canvas that observes the document.
 */
export function useBoardHistory(board: BoardDocument) {
  useSyncExternalStore(useCallback(fn => subscribePinHistory(board, fn), [board]), () => pinHistoryVersion(board));
  const [, forceRender] = useState(0);
  const undo = useCallback(() => {
    if (!replayPin(board, false)) board.undoOnce();
    forceRender((n) => n + 1);
  }, [board]);
  const redo = useCallback(() => {
    if (!replayPin(board, true)) board.redoOnce();
    forceRender((n) => n + 1);
  }, [board]);
  return { undo, redo, forceRender, pinUndo: hasPinHistory(board, false), pinRedo: hasPinHistory(board, true) };
}
