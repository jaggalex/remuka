import { boardSnapshot, buildSelectionSource, selectionTexts } from "@remo/agent-plan/model-context";
import type { BoardDocument } from "@remo/doc";

/** Both sides read the same Yjs maps with the same extractors. The task runner
 * takes its snapshot at execution time, so a concurrent board edit can update it. */
export function agentPayload(board: BoardDocument, selectionIds: readonly string[]) {
  return {
    selection: buildSelectionSource(board.doc, selectionIds),
    diagram: selectionTexts(board.doc, selectionIds),
    snapshot: boardSnapshot(board.doc),
  };
}
