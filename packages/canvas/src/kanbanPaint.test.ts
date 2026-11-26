import { describe, expect, it } from "vitest";
import { TONE_LEVELS } from "@remo/model";
import { columnHeaderBox, columnHeaderText, drawKanban, fittedColumnHeader, kanbanTitleAt } from "./kanban";
import { layoutKanban } from "./layout";
import { DEFAULT_PALETTE } from "./palette";
import type { KanbanState } from "@remo/model";
import type { Widget } from "@remo/model";

/**
 * The kanban face of ADR-267 §2.1: the header reads "Name · n/limit", an over-limit
 * column says so in danger ink and marks its extra cards, the accent stripe is gone, and a
 * card is filled with its column's colour.
 */
function recorder() {
  const texts: Array<{ text: string; fill: unknown; font: unknown }> = [];
  const fills: Array<{ fill: unknown; at: [number, number, number, number] }> = [];
  const paints: unknown[] = [];
  const strokes: Array<{ style: unknown; dash: unknown }> = [];
  const state: Record<string | symbol, unknown> = { getTransform: () => ({ a: 1, b: 0 }) };
  const ctx = new Proxy(state, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === "measureText") return (text: string) => ({ width: String(text).length * 7 });
      if (key === "fillText") {
        return (text: string) => {
          texts.push({ text, fill: target.fillStyle, font: target.font });
        };
      }
      if (key === "fillRect") {
        return (x: number, y: number, w: number, h: number) => {
          fills.push({ fill: target.fillStyle, at: [x, y, w, h] });
        };
      }
      if (key === "fill") {
        return () => paints.push(target.fillStyle);
      }
      if (key === "stroke") {
        return () => strokes.push({ style: target.strokeStyle, dash: target.lineDashOffset });
      }
      return () => undefined;
    },
    set(target, key, value) {
      target[key] = value;
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, texts, fills, paints, strokes };
}

const kanban: Widget = {
  id: "k1",
  type: "kanban",
  parentId: null,
  x: 0,
  y: 0,
  width: 900,
  height: 420,
};
const card = (id: string, fillColor?: string): Widget => ({
  id,
  type: "card",
  parentId: "k1",
  x: 0,
  y: 0,
  width: 253.6,
  height: 79.14,
  title: id,
  ...(fillColor ? { style: { fillColor } } : {}),
});

const state: KanbanState = {
  columns: [
    { id: "c1", title: "Doing", accent: TONE_LEVELS.yellow[300], width: 450, wipLimit: 1 },
    { id: "c2", title: "Done", accent: TONE_LEVELS.green[300], width: 450 },
  ],
  swimlanes: [{ id: "l1", title: "Team" }],
  cards: {
    a: { columnId: "c1", swimlaneId: "l1", order: "n" },
    b: { columnId: "c1", swimlaneId: "l1", order: "t" },
    c: { columnId: "c2", swimlaneId: "l1", order: "n" },
  },
  newColumnWidth: 450,
  headerHeight: 96,
};

describe("column header text", () => {
  it("reads 'Name · n' and 'Name · n/limit'", () => {
    expect(columnHeaderText({ title: "Backlog", count: 3 })).toBe("Backlog · 3");
    expect(columnHeaderText({ title: "Doing", count: 2, wipLimit: 2 })).toBe("Doing · 2/2");
    expect(columnHeaderText({ title: "Doing", count: 3, wipLimit: 2 })).toBe("Doing · 3/2");
  });
});

describe("drawKanban (ADR-267 §2.1)", () => {
  const layout = layoutKanban(kanban, [card("a"), card("b"), card("c")], state);
  const titles = new Map([
    ["a", "a"],
    ["b", "b"],
    ["c", "c"],
  ]);

  it("paints one ink header per column and no accent stripe", () => {
    const { ctx, texts, fills, paints } = recorder();
    drawKanban(ctx, layout, 1, titles, { palette: DEFAULT_PALETTE, cards: new Map() });
    const headers = texts.filter((entry) => entry.text.includes(" · "));
    expect(headers.map((entry) => entry.text)).toEqual(["Doing · 2/1", "Done · 1"]);
    expect(headers.every((entry) => String(entry.font).startsWith("800 "))).toBe(true);
    // The over-limit column is danger ink; the other is ordinary ink.
    expect(headers[0]!.fill).toBe(DEFAULT_PALETTE.dangerInk);
    expect(headers[1]!.fill).toBe(DEFAULT_PALETTE.objectInk);
    // The accent is a rounded swatch on the shared board/export painter, never a stripe.
    expect(paints).toEqual(expect.arrayContaining(layout.columns.map(column => column.accent)));
    expect(fills.filter((fill) => fill.fill === TONE_LEVELS.yellow[300])).toHaveLength(0);
  });

  it("hits the whole column button at both zoom levels and leaves its outer band draggable", () => {
    const column = layout.columns[0]!;
    const measure = (value: string) => value.length * 7;
    for (const zoom of [.5, 2]) {
      const box = columnHeaderBox(layout, column, zoom);
      for (const x of [box.x + 1, box.x + box.width / 2, box.x + box.width - 1]) {
        expect(kanbanTitleAt(layout, { x, y: box.y + 1 }, measure, undefined, zoom)?.id).toBe(column.id);
      }
      expect(kanbanTitleAt(layout, { x: column.left + column.width - 1, y: box.y + 1 }, measure, undefined, zoom)).toBeNull();
    }
    const {ctx} = recorder();
    expect(fittedColumnHeader(ctx, { ...column, title: "A very long column title" }, 90)).toMatch(/… · 2\/1$/);
  });

  it("fills a card with its column's colour and a chosen colour wins", () => {
    const plain = recorder();
    drawKanban(plain.ctx, layout, 1, titles, { palette: DEFAULT_PALETTE, cards: new Map() });
    expect(plain.paints).toContain("#f2b94a");
    expect(plain.paints).toContain("#85d965");

    const own = recorder();
    drawKanban(own.ctx, layout, 1, titles, {
      palette: DEFAULT_PALETTE,
      cards: new Map([["c", card("c", "#cddff8")]]),
    });
    expect(own.paints).toContain("#cddff8");
    // Only the header swatch keeps the accent after that card receives its own fill.
    expect(own.paints.filter(fill => fill === "#85d965")).toHaveLength(1);
  });

  it("paints a row-600 accent as the header's colour and keeps ink for a fill row", () => {
    const deep = {
      ...state,
      columns: [
        { id: "c1", title: "Doing", accent: TONE_LEVELS.blue[600], width: 450 },
        { id: "c2", title: "Done", accent: TONE_LEVELS.green[300], width: 450 },
      ],
    };
    const deepLayout = layoutKanban(kanban, [card("a"), card("b"), card("c")], deep);
    const { ctx, texts } = recorder();
    drawKanban(ctx, deepLayout, 1, titles, { palette: DEFAULT_PALETTE, cards: new Map() });
    const headers = texts.filter((entry) => entry.text.includes(" · "));
    expect(headers[0]!.fill).toBe(TONE_LEVELS.blue[600]);
    expect(headers[1]!.fill).toBe(DEFAULT_PALETTE.objectInk);
  });

  it("draws a dashed danger outline around the cards over the limit", () => {
    const { ctx, strokes } = recorder();
    drawKanban(ctx, layout, 1, titles, { palette: DEFAULT_PALETTE, cards: new Map() });
    // One dashed danger stroke: card "b" is the second in a one-card column.
    const danger = strokes.filter((entry) => entry.style === DEFAULT_PALETTE.dangerInk);
    expect(danger).toHaveLength(1);
  });
});
