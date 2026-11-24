import { describe, expect, it } from "vitest";
import { CARD_WHITE, type Widget } from "@remo/model";
import { CARD_RADIUS, CARD_SHADOW, drawCardSheet } from "./cardSheet";
import { DEFAULT_PALETTE } from "./palette";
import { drawWidget } from "./render";

/** Records each call with the style in force when it was made. */
function recorder() {
  const calls: Array<{ name: string; args: unknown[]; strokeStyle?: unknown; fillStyle?: unknown }> = [];
  const state: Record<string | symbol, unknown> = { getTransform: () => ({ a: 1, b: 0 }) };
  const ctx = new Proxy(state, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === "measureText") return () => ({ width: 10 });
      return (...args: unknown[]) => {
        calls.push({
          name: String(key),
          args,
          strokeStyle: target.strokeStyle,
          fillStyle: target.fillStyle,
        });
      };
    },
    set(target, key, value) {
      target[key] = value;
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

const box = { x: 0, y: 0, width: 200, height: 40 };

describe("card sheet (ADR-234, ADR-267)", () => {
  it("is an outlined sheet on a hard ink shadow, radius 10", () => {
    const { ctx, calls } = recorder();
    drawCardSheet(ctx, box, 1);
    // The shadow first: the same silhouette, offset, in ink, with no blur.
    const fills = calls.filter((c) => c.name === "fill");
    expect(fills).toHaveLength(2);
    expect(fills[0]!.fillStyle).toBe(DEFAULT_PALETTE.objectInk);
    expect(calls.find((c) => c.name === "moveTo")?.args).toEqual([
      CARD_RADIUS + CARD_SHADOW.offset,
      CARD_SHADOW.offset,
    ]);
    // White paper when no column gave the card a colour.
    expect(fills[1]!.fillStyle).toBe(CARD_WHITE);
    // One ink outline.
    const strokes = calls.filter((c) => c.name === "stroke");
    expect(strokes).toHaveLength(1);
    expect(strokes[0]!.strokeStyle).toBe(DEFAULT_PALETTE.objectInk);
  });

  it("takes the fill it is given, so a column can paint a card", () => {
    const { ctx, calls } = recorder();
    drawCardSheet(ctx, box, 1, { fill: "#f2b94a" });
    expect(calls.filter((c) => c.name === "fill").at(-1)!.fillStyle).toBe("#f2b94a");
  });

  it("frames only the selection, outside the sheet", () => {
    const { ctx, calls } = recorder();
    drawCardSheet(ctx, box, 2, { selected: true });
    const strokes = calls.filter((c) => c.name === "stroke");
    expect(strokes).toHaveLength(2);
    expect(strokes[0]!.strokeStyle).toBe(DEFAULT_PALETTE.objectInk);
    expect(strokes[1]!.strokeStyle).toBe(DEFAULT_PALETTE.selectionStroke);
    const moves = calls.filter((c) => c.name === "moveTo");
    const [, y] = moves.at(-1)!.args as [number, number];
    expect(y).toBeLessThan(box.y);
  });

  it("paints a free card the same way, whatever its cardTheme", () => {
    const { ctx, calls } = recorder();
    const card = {
      id: "c1",
      type: "card",
      x: 100,
      y: 20,
      width: 200,
      height: 40,
      title: "Ship",
      style: { cardTheme: "#ffdd33" },
    } as unknown as Widget;
    drawWidget(ctx, card, 1, { selectedIds: [] });
    expect(calls.filter((c) => c.name === "stroke" && c.strokeStyle === "#ffdd33")).toEqual([]);
    expect(calls.filter((c) => c.name === "fill" && c.fillStyle === "#ffdd33")).toEqual([]);
  });
});
