import { answersKey, backTextKey, sideOf } from "@remo/model";
import { describe, expect, it } from "vitest";
import { BoardDocument } from "./board";
import { copyFragment, pasteFragment } from "./clipboard";
import { clearContent, noteMarksOf, setWidgetDelta, setWidgetText } from "./text";

function boardWithNote(): { board: BoardDocument; id: string } {
  const board = new BoardDocument();
  board.widgets.set("f1", {
    id: "f1",
    type: "frame",
    parentId: null,
    x: 0,
    y: 0,
    width: 600,
    height: 400,
  });
  board.widgets.set("s1", {
    id: "s1",
    type: "sticky_note",
    parentId: "f1",
    x: 20,
    y: 20,
    width: 180,
    height: 140,
  });
  return { board, id: "s1" };
}

describe("two-sided sticky notes in the document (ADR-320)", () => {
  it("materializes the back text and the shown frames", () => {
    const { board, id } = boardWithNote();
    setWidgetText(board, id, "question");
    setWidgetText(board, id, "answer", { side: "back" });

    const before = board.snapshot();
    expect(before.widgets.find((widget) => widget.id === id)).toMatchObject({
      content: "question",
      backContent: "answer",
    });
    expect(before.answersVisible).toEqual([]);

    board.transact(() => board.meta.set(answersKey("f1"), "1"));
    const shown = board.snapshot();
    expect(shown.answersVisible).toEqual(["f1"]);
    const note = shown.widgets.find((widget) => widget.id === id)!;
    expect(sideOf(note, true, new Set(shown.answersVisible))).toBe("back");
  });

  it("treats an empty back as one-sided and can remove it", () => {
    const { board, id } = boardWithNote();
    setWidgetText(board, id, "  ", { side: "back" });
    expect(board.snapshot().widgets.find((widget) => widget.id === id)?.backContent).toBeUndefined();

    setWidgetText(board, id, "answer", { side: "back" });
    clearContent(board, [id], "back");
    expect(board.texts.has(backTextKey(id))).toBe(false);
    expect(board.snapshot().widgets.find((widget) => widget.id === id)?.backContent).toBeUndefined();
  });

  it("keeps formatting on the back side", () => {
    const { board, id } = boardWithNote();
    setWidgetDelta(board, id, [{ insert: "answer", attributes: { bold: true } }], {
      side: "back",
    });
    const note = board.snapshot().widgets.find((widget) => widget.id === id)!;
    expect(note.backContent).toBe("answer");
    expect(note.backRuns?.some((run) => run.bold)).toBe(true);
    expect(noteMarksOf(board, id, "back")).toEqual({ bold: true });
    expect(note.content).toBeUndefined();
  });

  it("does not believe a back field written into the widget record", () => {
    const { board, id } = boardWithNote();
    board.widgets.set(id, {
      ...board.widgets.get(id)!,
      backContent: "wire",
    });
    expect(board.readWidget(id)?.backContent).toBeUndefined();
    expect(board.snapshot().widgets.find((widget) => widget.id === id)?.backContent).toBeUndefined();
  });

  it("copies and pastes both sides", () => {
    const { board, id } = boardWithNote();
    setWidgetText(board, id, "question");
    setWidgetText(board, id, "answer", { side: "back" });

    const fragment = copyFragment(board, ["f1"])!;
    expect(fragment.backs?.[id]?.delta).toEqual([{ insert: "answer" }]);

    const roots = pasteFragment(board, fragment, { offset: { x: 40, y: 40 } });
    const pasted = board.snapshot().widgets.find(
      (widget) => widget.type === "sticky_note" && widget.id !== id,
    )!;
    expect(roots.length).toBe(1);
    expect(pasted.content).toBe("question");
    expect(pasted.backContent).toBe("answer");
    expect(pasted.parentId).not.toBe("f1");
  });
});
