import { describe, expect, it } from "vitest";
import { BoardDocument, createShape, setShapeKind } from "./board";

describe("switching a shape's kind (ADR-271)", () => {
  it("changes only the kind, and one undo puts the old one back", () => {
    const board = new BoardDocument();
    createShape(
      board,
      "s1",
      "rectangle",
      { x: 120, y: 80 },
      { fillColor: "#cddff8", strokeWidth: 3 },
      { width: 150, height: 90 },
    );
    const before = board.widgets.get("s1")!;
    const steps = board.canUndo;

    setShapeKind(board, ["s1"], "triangle");
    const after = board.widgets.get("s1")!;
    expect(after.shapeKind).toBe("triangle");
    expect(after.width).toBe(before.width);
    expect(after.height).toBe(before.height);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.style).toEqual(before.style);

    board.undoOnce();
    expect(board.widgets.get("s1")!.shapeKind).toBe("rectangle");
    // The switch was one transaction, not one per property.
    expect(board.canUndo).toBe(steps);
  });

  it("changes every selected shape and skips notes, cards and locked shapes", () => {
    const board = new BoardDocument();
    createShape(board, "a", "rectangle", { x: 0, y: 0 });
    createShape(board, "b", "ellipse", { x: 300, y: 0 });
    createShape(board, "locked", "rectangle", { x: 600, y: 0 });
    const locked = board.widgets.get("locked")!;
    board.widgets.set("locked", { ...locked, locked: true });

    setShapeKind(board, ["a", "b", "locked", "missing"], "round_rectangle");

    expect(board.widgets.get("a")!.shapeKind).toBe("round_rectangle");
    expect(board.widgets.get("b")!.shapeKind).toBe("round_rectangle");
    expect(board.widgets.get("locked")!.shapeKind).toBe("rectangle");
  });

  it("writes nothing when the kind already matches", () => {
    const board = new BoardDocument();
    createShape(board, "a", "diamond", { x: 0, y: 0 });
    const steps = board.canUndo;
    setShapeKind(board, ["a"], "diamond");
    expect(board.canUndo).toBe(steps);
  });
});
