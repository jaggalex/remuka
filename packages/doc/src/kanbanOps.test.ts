import { describe, expect, it } from "vitest";
import { emptyKanbanState, TODO_ACCENT, TONE_LEVELS } from "@remo/model";
import { BoardDocument } from "./board";
import { createKanban } from "./kanbanOps";

/** A hand-made kanban is the same data a template writes (ADR-266 §10a). */
describe("createKanban", () => {
  it("adds the widget, its columns and its lane in one undo step", () => {
    const board = new BoardDocument();
    const state = emptyKanbanState({
      columns: [
        { id: "col1", title: "To do", accent: TODO_ACCENT, width: 300 },
        { id: "col2", title: "Done", accent: TONE_LEVELS.green[300], width: 300 },
      ],
      swimlanes: [{ id: "lane1", title: "Product" }],
    });
    createKanban(board, "k1", { x: 40, y: 60 }, state);

    expect(board.readWidget("k1")).toMatchObject({ type: "kanban", x: 40, y: 60 });
    const snapshot = board.snapshot();
    expect(snapshot.kanbanStates.k1?.columns.map((column) => column.title)).toEqual([
      "To do",
      "Done",
    ]);
    expect(snapshot.kanbanStates.k1?.swimlanes).toHaveLength(1);

    board.undo.undo();
    expect(board.readWidget("k1")).toBeNull();
  });
});
