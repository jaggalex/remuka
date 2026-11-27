import { describe, expect, it } from "vitest";
import type { Widget } from "@remo/model";
import { anchorAt, pinWorld } from "./commentGeometry";

const shape: Widget = { id: "s", type: "shape", parentId: null, x: 200, y: 100, width: 240, height: 100, rotation: 90 };
const layouts = new Map();
describe("object-relative comment anchors", () => {
  it("inverts the projected click and follows rotation, translation and resizing", () => {
    const anchor = anchorAt({ x: 225, y: 160 }, [shape], layouts);
    expect(anchor).toMatchObject({ kind: "widget", widgetId: "s", fx: .75, fy: .25 });
    expect(pinWorld(anchor, shape, layouts)).toEqual({ x: 225, y: 160 });
    const changed = { ...shape, x: 90, y: 70, width: 300, height: 200, rotation: 0 };
    expect(pinWorld(anchor, changed, layouts)).toEqual({ x: 165, y: 20 });
  });
  it("uses the top centre for a legacy object, keeps world anchors and omits deleted objects", () => {
    const old = { kind: "widget", widgetId: "s" } as const;
    expect(pinWorld(old, { ...shape, rotation: 0 }, layouts)).toEqual({ x: 200, y: 50 });
    expect(pinWorld(old, undefined, layouts)).toBeNull();
    expect(anchorAt({ x: -50, y: 9 }, [shape], layouts)).toEqual({ kind: "point", x: -50, y: 9 });
  });
});
