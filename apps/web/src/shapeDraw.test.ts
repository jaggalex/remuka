import { describe, expect, it } from "vitest";
import { drawnShapeBox, isShapeDrag, SHAPE_DRAG_THRESHOLD_PX } from "./shapeDraw";

describe("drawing a shape by dragging (ADR-271)", () => {
  it("draws a box from the press to the pointer", () => {
    expect(drawnShapeBox({ x: 0, y: 0 }, { x: 150, y: 90 })).toEqual({
      x: 0,
      y: 0,
      width: 150,
      height: 90,
    });
  });

  it("follows the pointer in every direction", () => {
    expect(drawnShapeBox({ x: 100, y: 100 }, { x: 40, y: 30 })).toEqual({
      x: 40,
      y: 30,
      width: 60,
      height: 70,
    });
    expect(drawnShapeBox({ x: 100, y: 100 }, { x: 160, y: 30 })).toEqual({
      x: 100,
      y: 30,
      width: 60,
      height: 70,
    });
  });

  it("makes a square with Shift, whichever axis travelled farther", () => {
    expect(drawnShapeBox({ x: 0, y: 0 }, { x: 90, y: 40 }, { square: true })).toEqual({
      x: 0,
      y: 0,
      width: 90,
      height: 90,
    });
    expect(drawnShapeBox({ x: 0, y: 0 }, { x: -40, y: -90 }, { square: true })).toEqual({
      x: -90,
      y: -90,
      width: 90,
      height: 90,
    });
  });

  it("grows around the press with Alt, and stays square with both keys", () => {
    expect(drawnShapeBox({ x: 100, y: 100 }, { x: 130, y: 120 }, { fromCenter: true })).toEqual({
      x: 70,
      y: 80,
      width: 60,
      height: 40,
    });
    expect(
      drawnShapeBox({ x: 100, y: 100 }, { x: 130, y: 120 }, { fromCenter: true, square: true }),
    ).toEqual({ x: 70, y: 70, width: 60, height: 60 });
  });

  it("tells a click from a drag in screen pixels", () => {
    expect(isShapeDrag({ x: 0, y: 0 }, { x: 3, y: 0 })).toBe(false);
    expect(isShapeDrag({ x: 0, y: 0 }, { x: SHAPE_DRAG_THRESHOLD_PX, y: 0 })).toBe(true);
  });
});
