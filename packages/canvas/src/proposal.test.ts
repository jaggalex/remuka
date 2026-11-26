import { describe, expect, it } from "vitest";
import type { Widget } from "@remo/model";
import { DEFAULT_PALETTE } from "./palette";
import { PROPOSAL_HULL, drawProposal, proposalLayout } from "./proposal";

/**
 * The proposal is read by a person over the live room; neither may receive an invented
 * box or line, and a broken plan must not take the room down (ADR-188).
 */
const none = () => undefined;

function note(id: string, x: number, y: number): Widget {
  return { id, type: "sticky_note", parentId: null, x, y, width: 100, height: 120 };
}

describe("proposalLayout", () => {
  it("turns centre-anchored objects into top-left boxes, frames first", () => {
    const layout = proposalLayout(
      {
        objects: [
          { tempId: "note", type: "sticky_note", x: 400, y: 300, width: 100, height: 100 },
          { tempId: "frame", type: "frame", x: 0, y: 0, width: 400, height: 300 },
        ],
      },
      none,
    );
    expect(layout.blocks.map((item) => item.type)).toEqual(["frame", "sticky_note"]);
    expect(layout.blocks[0]).toMatchObject({ key: "new-frame", x: -200, y: -150, width: 400 });
    expect(layout.bounds).toEqual({ x: -200, y: -150, width: 650, height: 500 });
    expect(layout.empty).toBe(false);
  });

  it("draws a line only when both ends are planned objects", () => {
    const layout = proposalLayout(
      {
        objects: [
          { tempId: "a", type: "sticky_note", x: 0, y: 0, width: 100, height: 100 },
          { tempId: "b", type: "sticky_note", x: 200, y: 150, width: 100, height: 100 },
        ],
        connectors: [
          { tempId: "link", from: "a", to: "b" },
          { from: "a", to: "board_only" },
        ],
      },
      none,
    );
    // Edge to edge along the centre line: (0,0)→(200,150) leaves each 100×100 box at y ±37.5.
    expect(layout.lines).toEqual([{ key: "link", x1: 50, y1: 37.5, x2: 150, y2: 112.5 }]);
  });

  it("places a moved object at its target with its live size, and frames both ends", () => {
    const widgets = new Map([["n1", note("n1", 0, 0)]]);
    const layout = proposalLayout(
      { placements: [{ id: "n1", x: 300, y: 0 }, { id: "gone", x: 1, y: 1 }] },
      (id) => widgets.get(id),
    );
    expect(layout.moves).toEqual([
      { key: "move-n1", type: "sticky_note", x: 250, y: -60, width: 100, height: 120 },
    ]);
    // The fit shows where it is now and where it goes.
    expect(layout.bounds).toEqual({ x: -50, y: -60, width: 400, height: 120 });
  });

  it("returns an empty layout instead of throwing on an empty or broken plan", () => {
    expect(proposalLayout(null, none)).toMatchObject({ empty: true, bounds: null });
    expect(proposalLayout({ objects: [{ x: "nope" }], placements: "x" }, none).empty).toBe(true);
    expect(
      proposalLayout({ objects: [{ type: "frame", x: 0, y: 0, width: -5, height: 10 }] }, none)
        .blocks,
    ).toEqual([]);
  });
});

describe("drawProposal", () => {
  function recorder() {
    const calls: Array<{ name: string; args: unknown[]; lineWidth?: unknown; strokeStyle?: unknown }> = [];
    const state: Record<string | symbol, unknown> = {};
    const ctx = new Proxy(state, {
      get(target, key) {
        if (key in target) return target[key];
        return (...args: unknown[]) => {
          calls.push({
            name: String(key),
            args,
            lineWidth: target.lineWidth,
            strokeStyle: target.strokeStyle,
          });
          if (key === "measureText") return { width: String(args[0]).length * 7 };
        };
      },
      set(target, key, value) {
        target[key] = value;
        return true;
      },
    });
    return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, state };
  }

  it("outlines a created frame as a rounded dashed hull in screen pixels", () => {
    const { ctx, calls, state } = recorder();
    const layout = proposalLayout(
      { objects: [{ tempId: "f", type: "frame", x: 0, y: 0, width: 400, height: 200 }] },
      none,
    );
    drawProposal(ctx, layout, 2, DEFAULT_PALETTE);
    const round = calls.find((call) => call.name === "roundRect");
    expect(round?.args).toEqual([-200, -100, 400, 200, 200 * PROPOSAL_HULL.corner]);
    expect(calls.find((call) => call.name === "setLineDash")?.args[0]).toEqual([3, 2.5]);
    expect(calls.find((call) => call.name === "stroke")?.lineWidth).toBe(0.75);
    expect(state.strokeStyle).toBe(DEFAULT_PALETTE.agent);
    // A hull is an outline: the frame is not filled as if it already existed.
    expect(calls.filter((call) => call.name === "fill")).toHaveLength(0);
  });

  it("paints nothing for an empty plan", () => {
    const { ctx, calls } = recorder();
    drawProposal(ctx, proposalLayout({}, none), 1, DEFAULT_PALETTE);
    expect(calls).toEqual([]);
  });

  it("labels only named tidy frames, in screen pixels, clipping long names to the group", () => {
    const plan = { objects: [
      { tempId: "a", type: "frame", title: "Процесс", x: 100, y: 60, width: 100, height: 80 },
      { tempId: "b", type: "sticky_note", title: "Note", x: 100, y: 60, width: 40, height: 40 },
      { tempId: "c", type: "frame", title: "  ", x: 300, y: 60, width: 100, height: 80 },
    ] };
    expect(proposalLayout(plan, none).blocks.every(block => !block.title)).toBe(true);
    const layout = proposalLayout(plan, none, true);
    expect(layout.blocks.filter(block => block.title).map(block => block.title)).toEqual(["Процесс"]);
    for (const [zoom, label] of [[2, "Процесс"], [0.5, "Про…"], [0.1, null]] as const) {
      const { ctx, calls } = recorder();
      drawProposal(ctx, layout, zoom, DEFAULT_PALETTE);
      expect(calls.find(call => call.name === "translate")?.args).toEqual([50, 20]);
      expect(calls.find(call => call.name === "scale")?.args).toEqual([1 / zoom, 1 / zoom]);
      expect(calls.filter(call => call.name === "fillText").map(call => call.args))
        .toEqual(label ? [[label, 10, -16]] : []);
    }
  });

  it("draws a planned connector as a 2 px dashed line in the agent's colour", () => {
    const { ctx, calls, state } = recorder();
    const layout = proposalLayout(
      {
        objects: [
          { tempId: "a", type: "sticky_note", x: 0, y: 0, width: 100, height: 100 },
          { tempId: "b", type: "sticky_note", x: 200, y: 0, width: 100, height: 100 },
        ],
        connectors: [{ tempId: "link", from: "a", to: "b" }],
      },
      none,
    );
    drawProposal(ctx, layout, 2, DEFAULT_PALETTE);
    // The hulls are 1.5 px; the planned line is the mockup's 2 px, both dashed.
    expect(calls.filter((call) => call.name === "lineTo")).toHaveLength(1);
    expect(state.strokeStyle).toBe(DEFAULT_PALETTE.agent);
    expect(calls.filter((call) => call.name === "setLineDash")).toHaveLength(1);
    // The line is the last stroke drawn, at 2 px / zoom (zoom 2 → 1 board unit).
    expect(calls.filter((call) => call.name === "stroke").at(-1)?.lineWidth).toBe(1);
  });
});
