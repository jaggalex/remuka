import { describe, expect, it } from "vitest";
import type { Widget } from "@remo/model";
import {
  angleAt,
  frameCorners,
  framePoint,
  resizedTurnedBox,
  rotationFrame,
  rotationHandle,
  rotationMembers,
} from "./rotationGeometry";

const shape = (overrides: Partial<Widget> = {}): Widget => ({
  id: "s",
  type: "shape",
  parentId: null,
  x: 0,
  y: 0,
  width: 160,
  height: 100,
  ...overrides,
});

describe("the selection frame of a turned object (T18)", () => {
  it("uses the object's own axes for one turned object", () => {
    const frame = rotationFrame([shape({ rotation: 45 })])!;
    expect(frame.angle).toBe(45);
    expect(frame.centre).toEqual({ x: 0, y: 0 });
    expect(frame.box).toEqual({ x: -80, y: -50, width: 160, height: 100 });
    const top = framePoint(frame, { x: 0, y: -50 });
    expect(top.x).toBeCloseTo(35.355, 3);
    expect(top.y).toBeCloseTo(-35.355, 3);
  });

  it("uses the described box for a block", () => {
    const frame = rotationFrame([
      shape({ id: "a", x: -100, y: 0 }),
      shape({ id: "b", x: 100, y: 0 }),
    ])!;
    expect(frame.angle).toBe(0);
    expect(frame.centre).toEqual({ x: 0, y: 0 });
    expect(frame.box).toMatchObject({ x: -180, y: -50, width: 360, height: 100 });
  });

  it("puts the round handle 14 + 5 screen pixels above the top side", () => {
    const frame = rotationFrame([shape()])!;
    const handle = rotationHandle(frame, 2);
    expect(handle.point.x).toBeCloseTo(0);
    expect(handle.point.y).toBeCloseTo(-50 - 19 / 2);
    expect(handle.stemFrom.y).toBeCloseTo(-50);
    expect(handle.stemTo.y).toBeCloseTo(-50 - 14 / 2);
  });

  it("keeps the opposite corner in the object's axes while resizing", () => {
    const before = shape({ rotation: 30 });
    // A point on the object's own south-east diagonal, turned into the world.
    const radians = (30 * Math.PI) / 180;
    const point = {
      x: 200 * Math.cos(radians) - 150 * Math.sin(radians),
      y: 200 * Math.sin(radians) + 150 * Math.cos(radians),
    };
    const after = resizedTurnedBox(before, "se", point, 0, 0);
    const corner = (box: typeof before) => {
      const local = { x: -box.width / 2, y: -box.height / 2 };
      const radians = (box.rotation! * Math.PI) / 180;
      return {
        x: box.x + local.x * Math.cos(radians) - local.y * Math.sin(radians),
        y: box.y + local.x * Math.sin(radians) + local.y * Math.cos(radians),
      };
    };
    const nwBefore = corner(before);
    const nwAfter = corner({ ...before, ...after, rotation: before.rotation });
    expect(after.width).toBeGreaterThan(before.width);
    expect(after.height).toBeGreaterThan(before.height);
    expect(nwAfter.x).toBeCloseTo(nwBefore.x, 6);
    expect(nwAfter.y).toBeCloseTo(nwBefore.y, 6);
  });

  it("carries a frame's contents into the gesture, but not a locked child", () => {
    const children: Widget[] = [
      shape({ id: "f", type: "frame", width: 400, height: 300 }),
      shape({ id: "child", parentId: "f", x: 100 }),
      shape({ id: "locked", parentId: "f", x: 200, locked: true }),
      shape({ id: "other", x: 600 }),
    ];
    expect(rotationMembers([children[0]!], children).map((entry) => entry.id)).toEqual([
      "f",
      "child",
    ]);
  });

  it("reports the angle of the pointer about the pivot", () => {
    expect(angleAt({ x: 0, y: 0 }, { x: 100, y: 0 })).toBeCloseTo(0);
    expect(angleAt({ x: 0, y: 0 }, { x: 0, y: 100 })).toBeCloseTo(90);
  });

  it("corners are the frame's, not the screen's", () => {
    const frame = rotationFrame([shape({ rotation: 90 })])!;
    const corners = frameCorners(frame);
    expect(corners.find((entry) => entry.corner === "ne")).toMatchObject({
      x: expect.closeTo(50, 5),
      y: expect.closeTo(80, 5),
    });
  });
});
