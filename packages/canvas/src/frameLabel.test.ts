import { describe, expect, it } from "vitest";
import type { Widget } from "@remo/model";
import { FRAME_LABEL, frameLabelAt, frameLabelRect, frameLabelText } from "./frameLabel";

/**
 * A frame's label is its handle (ADR-267): the same plate is painted on the canvas and
 * hit-tested by the gesture machine, so the two must come from one function.
 */
const measure = { measureText: (text: string) => ({ width: text.length * 7 }) };

function frame(id: string, over: Partial<Widget> = {}): Widget {
  return {
    id,
    type: "frame",
    x: 300,
    y: 200,
    width: 400,
    height: 300,
    title: "Раздел",
    ...over,
  } as Widget;
}

describe("frame label (ADR-267)", () => {
  it("sits above the top-left corner and overlaps the body by the gap", () => {
    const plate = frameLabelRect(frame("f"), 100);
    // Box left/top are 100/50; the plate is 24 tall and 2 of it overlap the frame.
    expect(plate).toEqual({
      x: 100,
      y: 50 - FRAME_LABEL.height + FRAME_LABEL.gap,
      width: 100,
      height: FRAME_LABEL.height,
    });
    expect(plate.y + plate.height).toBe(52);
  });

  it("has no plate for a nameless frame, and never invents a title", () => {
    expect(frameLabelText(frame("f", { title: "  " }))).toBe("");
    const widgets = [frame("empty", { title: "" })];
    expect(frameLabelAt(widgets, { x: 120, y: 44 }, measure)).toBeNull();
  });

  it("hit-tests the plate, not the body, so the body keeps its own press", () => {
    const widgets = [frame("f")];
    // The title is 6 characters → 42 px + 20 padding = 62; x 100…162, y 28…52.
    expect(frameLabelAt(widgets, { x: 120, y: 40 }, measure)?.id).toBe("f");
    // Same x, just below the plate: the frame's body, which pick() handles.
    expect(frameLabelAt(widgets, { x: 120, y: 60 }, measure)).toBeNull();
    // To the right of the measured plate.
    expect(frameLabelAt(widgets, { x: 200, y: 40 }, measure)).toBeNull();
  });

  it("returns the topmost frame when two labels overlap", () => {
    const widgets = [frame("back"), frame("front", { title: "Раздел" })];
    expect(frameLabelAt(widgets, { x: 120, y: 40 }, measure)?.id).toBe("front");
  });

  it("ignores objects that are not frames", () => {
    const note = { ...frame("n"), type: "sticky_note" } as Widget;
    expect(frameLabelAt([note], { x: 120, y: 40 }, measure)).toBeNull();
  });
});
