import { describe, expect, it } from "vitest";
import { bounds, toBoard, type NormalizedTemplate } from "./template";

describe("a template with a turned object (ADR-271, T18)", () => {
  it("reads the angle and normalises it", () => {
    const template: NormalizedTemplate = {
      types: { shape: 1 },
      widgets: [
        {
          z: 1,
          id: "s1",
          type: "shape",
          x: 0,
          y: 0,
          width: 160,
          height: 100,
          parentId: null,
          rotation: 270,
        },
      ],
    };
    const board = toBoard("kanban-framework", template);
    expect(board.widgets[0]?.rotation).toBe(-90);
  });

  it("measures the described rectangle of a turned object", () => {
    const board = toBoard("kanban-framework", {
      types: { shape: 1 },
      widgets: [
        {
          z: 1,
          id: "s1",
          type: "shape",
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          parentId: null,
          rotation: 45,
        },
      ],
    });
    const box = bounds(board.widgets);
    expect(box.width).toBeCloseTo(Math.SQRT2 * 100);
    expect(box.x + box.width / 2).toBeCloseTo(0);
  });
});
