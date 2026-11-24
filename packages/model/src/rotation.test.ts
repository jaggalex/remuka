import { describe, expect, it } from "vitest";
import {
  isRotatable,
  normalizeDegrees,
  rightAngleSnap,
  rotatedBounds,
  rotatedContains,
  rotatedCorners,
  rotatedOverlapsRect,
  rotationOf,
  selectionCentre,
  snapToStep,
  turnedPlacements,
} from "./rotation";
import type { Widget } from "./types";

const note = (overrides: Partial<Widget> = {}): Widget => ({
  id: "n1",
  type: "sticky_note",
  parentId: null,
  x: 100,
  y: 100,
  width: 200,
  height: 100,
  ...overrides,
});

describe("the stored angle (ADR-271, T18)", () => {
  it("normalises into (−180, 180] and never returns negative zero", () => {
    expect(normalizeDegrees(0)).toBe(0);
    expect(normalizeDegrees(360)).toBe(0);
    expect(normalizeDegrees(-360)).toBe(0);
    expect(normalizeDegrees(180)).toBe(180);
    expect(normalizeDegrees(-180)).toBe(180);
    expect(normalizeDegrees(270)).toBe(-90);
    expect(normalizeDegrees(-270)).toBe(90);
    expect(normalizeDegrees(725)).toBe(5);
    expect(Object.is(normalizeDegrees(-360), -0)).toBe(false);
    expect(normalizeDegrees(Number.NaN)).toBe(0);
    expect(normalizeDegrees(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("honours an angle only on a kind that turns", () => {
    expect(isRotatable(note({ rotation: 12 }))).toBe(true);
    expect(isRotatable(note({ type: "shape" }))).toBe(true);
    expect(isRotatable(note({ type: "text" }))).toBe(true);
    expect(isRotatable(note({ type: "image" }))).toBe(true);
    expect(isRotatable(note({ type: "frame" }))).toBe(true);
    expect(isRotatable(note({ type: "kanban" }))).toBe(false);
    expect(isRotatable(note({ type: "card" }))).toBe(false);
    expect(isRotatable(note({ type: "connector" }))).toBe(false);
    expect(isRotatable(note({ type: "timer" }))).toBe(false);
    // A table section is a frame with a layout, and stays straight.
    expect(
      isRotatable(
        note({
          type: "frame",
          layout: {
            kind: "table",
            columns: [{ id: "c1", title: "A" }],
            rows: [{ id: "r1", title: "1" }],
          },
        }),
      ),
    ).toBe(false);
    expect(rotationOf(note({ type: "kanban", rotation: 12 }))).toBe(0);
  });

  it("snaps to right angles within three degrees, and to a step under Shift", () => {
    expect(rightAngleSnap(2)).toBe(0);
    expect(rightAngleSnap(88)).toBe(90);
    expect(rightAngleSnap(182)).toBe(180);
    expect(rightAngleSnap(272)).toBe(-90);
    expect(rightAngleSnap(4)).toBe(4);
    expect(rightAngleSnap(-12)).toBe(-12);
    expect(snapToStep(12, 15)).toBe(15);
    expect(snapToStep(-22, 15)).toBe(-15);
    expect(snapToStep(-30, 15)).toBe(-30);
  });
});

describe("the painted outline (ADR-271, T18)", () => {
  it("keeps the centre and swaps the extents at a quarter turn", () => {
    const box = rotatedBounds(note({ rotation: 90 }));
    expect(box.x).toBeCloseTo(50);
    expect(box.y).toBeCloseTo(0);
    expect(box.width).toBeCloseTo(100);
    expect(box.height).toBeCloseTo(200);

    const diagonal = rotatedBounds(note({ width: 100, height: 100, rotation: 45 }));
    expect(diagonal.width).toBeCloseTo(Math.SQRT2 * 100);
    expect(diagonal.height).toBeCloseTo(Math.SQRT2 * 100);
    expect(diagonal.x + diagonal.width / 2).toBeCloseTo(100);
    expect(diagonal.y + diagonal.height / 2).toBeCloseTo(100);
  });

  it("lists the four corners in paint order", () => {
    const corners = rotatedCorners(note({ x: 0, y: 0, width: 100, height: 50, rotation: 90 }));
    expect(corners[0]!.x).toBeCloseTo(25);
    expect(corners[0]!.y).toBeCloseTo(-50);
    expect(corners[2]!.x).toBeCloseTo(-25);
    expect(corners[2]!.y).toBeCloseTo(50);
  });

  it("does not hit the empty corner of the described rectangle", () => {
    const turned = note({ x: 0, y: 0, width: 100, height: 100, rotation: 45 });
    const box = rotatedBounds(turned);
    // The axis-aligned corner is far outside a diamond.
    expect(box.width).toBeGreaterThan(140);
    expect(rotatedContains(turned, { x: box.x + 1, y: box.y + 1 })).toBe(false);
    // A point on the turned edge belongs to the object.
    expect(rotatedContains(turned, { x: 0, y: -50 })).toBe(true);
    expect(rotatedContains(turned, { x: -50, y: 0 })).toBe(true);
    expect(rotatedContains(turned, { x: 0, y: 0 })).toBe(true);
  });

  it("a marquee in the empty corner of the described rectangle takes nothing", () => {
    const turned = note({ x: 0, y: 0, width: 100, height: 100, rotation: 45 });
    const box = rotatedBounds(turned);
    const corner = { x: box.x, y: box.y, width: 6, height: 6 };
    expect(rotatedOverlapsRect(turned, corner)).toBe(false);
    // A marquee over the middle touches the object.
    expect(
      rotatedOverlapsRect(turned, { x: -10, y: -10, width: 20, height: 20 }),
    ).toBe(true);
    // A flat object keeps the old box test.
    expect(
      rotatedOverlapsRect(note({ x: 0, y: 0, width: 100, height: 100 }), {
        x: -10,
        y: -10,
        width: 20,
        height: 20,
      }),
    ).toBe(true);
  });
});

describe("a selection turns about one centre (T18 acceptance 6)", () => {
  const a = note({ id: "a", x: 0, y: 0, width: 100, height: 100 });
  const b = note({ id: "b", x: 300, y: 0, width: 100, height: 100 });
  const c = note({ id: "c", x: 0, y: 300, width: 100, height: 100 });

  it("computes the centre of the painted boxes", () => {
    const centre = selectionCentre([a, b, c]);
    expect(centre!.x).toBeCloseTo(150);
    expect(centre!.y).toBeCloseTo(150);
  });

  it("gives every object its own angle and keeps its distance from the centre", () => {
    const centre = selectionCentre([a, b, c])!;
    const turned = turnedPlacements([a, b, c], centre, 90);
    // +90° is clockwise on screen (y grows down): the square's corners trade places.
    const at = (id: string) => turned.find((entry) => entry.id === id)!;
    expect(at("a").rotation).toBe(90);
    expect(at("a").x).toBeCloseTo(300);
    expect(at("a").y).toBeCloseTo(0);
    expect(at("b").x).toBeCloseTo(300);
    expect(at("b").y).toBeCloseTo(300);
    expect(at("c").x).toBeCloseTo(0);
    expect(at("c").y).toBeCloseTo(0);

    // A single object stays in place and only turns.
    const single = turnedPlacements([a], selectionCentre([a])!, 15);
    expect(single[0]).toMatchObject({ x: 0, y: 0, rotation: 15, turned: true });
  });

  it("skips a kind that does not turn", () => {
    const kanban = note({ id: "k", type: "kanban", rotation: 0 });
    expect(turnedPlacements([a, kanban], selectionCentre([a, kanban])!, 30)).toHaveLength(1);
  });
});
