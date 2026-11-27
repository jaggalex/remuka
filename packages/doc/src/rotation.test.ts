import { describe, expect, it } from "vitest";
import type { Widget } from "@remo/model";
import { BoardDocument } from "./board";
import { rotateWidgets, setWidgetRotation } from "./rotation";
import { createWidget } from "./widgets";

function add(board: BoardDocument, id: string, overrides: Partial<Widget> = {}): Widget {
  const widget: Widget = {
    id,
    type: "sticky_note",
    parentId: null,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    ...overrides,
  };
  createWidget(board, widget);
  return widget;
}

describe("rotating objects (ADR-271, T18)", () => {
  it("turns a single object about its own centre as one undo step", () => {
    const board = new BoardDocument();
    add(board, "a");
    const steps = board.canUndo;
    rotateWidgets(board, ["a"], -12);
    expect(board.readWidget("a")).toMatchObject({ x: 0, y: 0, rotation: -12 });
    board.undoOnce();
    expect(board.readWidget("a")!.rotation).toBeUndefined();
    expect(board.canUndo).toBe(steps);
  });

  it("turns a selection about its common centre, each object with its own angle", () => {
    const board = new BoardDocument();
    add(board, "a", { x: 0, y: 0 });
    add(board, "b", { x: 300, y: 0 });
    add(board, "c", { x: 0, y: 300 });
    rotateWidgets(board, ["a", "b", "c"], 90);
    const at = (id: string) => board.readWidget(id)!;
    expect(at("a").rotation).toBe(90);
    expect(at("a").x).toBeCloseTo(300);
    expect(at("a").y).toBeCloseTo(0);
    expect(at("b").x).toBeCloseTo(300);
    expect(at("b").y).toBeCloseTo(300);
    expect(at("c").x).toBeCloseTo(0);
    expect(at("c").y).toBeCloseTo(0);
  });

  it("keeps a turned object's existing angle when the set turns again", () => {
    const board = new BoardDocument();
    add(board, "a", { rotation: 10 });
    rotateWidgets(board, ["a"], 15);
    expect(board.readWidget("a")!.rotation).toBe(25);
    rotateWidgets(board, ["a"], 180);
    expect(board.readWidget("a")!.rotation).toBe(-155);
  });

  it("honours Shift steps and the right-angle magnet through the same options", () => {
    const board = new BoardDocument();
    add(board, "a", { rotation: 1 });
    rotateWidgets(board, ["a"], 2, { magnet: true });
    expect(board.readWidget("a")!.rotation).toBe(0);
    rotateWidgets(board, ["a"], 22, { step: 15 });
    expect(board.readWidget("a")!.rotation).toBe(15);
  });

  it("turns a frame's contents with the frame, about the frame's own centre", () => {
    const board = new BoardDocument();
    add(board, "frame", { type: "frame", x: 50, y: 0, width: 400, height: 300 });
    add(board, "child", { parentId: "frame", x: 150, y: 0 });
    add(board, "free", { x: 400, y: 0 });
    rotateWidgets(board, ["frame"], 90);
    const frame = board.readWidget("frame")!;
    expect(frame.rotation).toBe(90);
    expect(frame.x).toBeCloseTo(50);
    expect(frame.y).toBeCloseTo(0);
    const child = board.readWidget("child")!;
    expect(child.rotation).toBe(90);
    expect(child.x).toBeCloseTo(50);
    expect(child.y).toBeCloseTo(100);
    // An object outside the frame is not touched.
    expect(board.readWidget("free")).toMatchObject({ x: 400, y: 0 });
    expect(board.readWidget("free")!.rotation).toBeUndefined();
  });

  it("skips kinds that do not turn, locked objects and missing ids", () => {
    const board = new BoardDocument();
    add(board, "kanban", { type: "kanban" });
    add(board, "locked", { locked: true });
    add(board, "note");
    rotateWidgets(board, ["kanban", "locked", "note", "missing"], 90);
    expect(board.readWidget("kanban")!.rotation).toBeUndefined();
    expect(board.readWidget("locked")!.rotation).toBeUndefined();
    expect(board.readWidget("note")!.rotation).toBe(90);
  });

  it("writes nothing when the gesture changes nothing", () => {
    const board = new BoardDocument();
    add(board, "a");
    const steps = board.canUndo;
    rotateWidgets(board, ["a"], 0);
    rotateWidgets(board, ["missing"], 30);
    setWidgetRotation(board, ["a"], 0);
    expect(board.canUndo).toBe(steps);
  });

  it("resets the angle without moving the object, in one step", () => {
    const board = new BoardDocument();
    add(board, "a", { x: 40, y: 60, rotation: -12 });
    const steps = board.canUndo;
    setWidgetRotation(board, ["a"], -180);
    expect(board.readWidget("a")).toMatchObject({ x: 40, y: 60, rotation: 180 });
    board.undoOnce();
    expect(board.canUndo).toBe(steps);
    expect(board.readWidget("a")!.rotation).toBe(-12);
  });

  it("resets a frame and its contents together", () => {
    const board = new BoardDocument();
    add(board, "frame", { type: "frame", x: 0, y: 0, width: 400, height: 300 });
    add(board, "child", { parentId: "frame", x: 100, y: 0 });
    rotateWidgets(board, ["frame"], 90);
    expect(board.readWidget("child")!.rotation).toBe(90);
    setWidgetRotation(board, ["frame"], 0);
    const frame = board.readWidget("frame")!;
    const child = board.readWidget("child")!;
    expect(frame.rotation).toBe(0);
    expect(child.rotation).toBe(0);
    expect(child.x).toBeCloseTo(100);
    expect(child.y).toBeCloseTo(0);
  });
});
