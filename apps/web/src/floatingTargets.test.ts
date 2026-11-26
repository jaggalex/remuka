import { describe, expect, it, vi } from "vitest";
import * as canvas from "@remo/canvas";
import type { Widget } from "@remo/model";
import { arrangeBarTarget, commonColour, connectorBarTarget, edgeContinueTargets, noteBarTarget, type Frame } from "./floatingTargets";
import { BAR_ROOM, COMPACT_BAR_ROOM } from "./canvasGeometry";
import { DEFAULT_SETTINGS } from "./settings";

/**
 * Where the floating bars land.
 *
 * These placements were two hundred lines inside `BoardCanvas.tsx`, where the only way to
 * check a bar was to open one and look at it. They are arithmetic on a camera and a box,
 * so they are tested as arithmetic (ADR-055).
 */

const frame: Frame = { camera: { x: 0, y: 0, zoom: 1 }, viewport: { width: 800, height: 600 } };

const note = (id: string, x: number, y: number, extra: Partial<Widget> = {}): Widget => ({
  id,
  type: "sticky_note",
  parentId: null,
  x,
  y,
  width: 100,
  height: 100,
  style: { fillColor: "#ffdd33" },
  ...extra,
});

const connector = (x: number, y: number, extra: Partial<Widget> = {}): Widget => ({
  id: "line",
  type: "connector",
  parentId: null,
  x,
  y,
  width: 200,
  height: 0,
  start: { item: "a", side: "right" },
  end: { item: "b", side: "left" },
  connectorShape: "straight",
  ...extra,
});

const resolveWith = (widgets: Widget[]) => (id: string) => widgets.find((w) => w.id === id);

describe("the note bar", () => {
  it("sits above the note, centred and clamped to the canvas", () => {
    // One colour sample instead of seven chips: the bar fits the design viewport.
    const wide: Frame = { ...frame, viewport: { width: 1440, height: 600 } };
    const target = noteBarTarget({
      widget: note("n", 0, 0),
      frame: wide,
      settings: DEFAULT_SETTINGS,
      marks: null,
    })!;
    expect(target.rect).toMatchObject({ left: 670, top: 250, width: 100, height: 100 });
    expect(target.placement.left).toBe(720 - 172);
    expect(target.placement.top).toBe(250 - BAR_ROOM);
  });

  it("goes below a note that is too close to the top", () => {
    const target = noteBarTarget({
      widget: note("n", 0, -240),
      frame,
      settings: DEFAULT_SETTINGS,
      marks: null,
    })!;
    expect(target.placement.top).toBeGreaterThan(target.rect.top);
  });

  it("never leaves the canvas on a narrow viewport", () => {
    const narrow: Frame = { ...frame, viewport: { width: 300, height: 600 } };
    const target = noteBarTarget({
      widget: note("n", 0, 0),
      frame: narrow,
      settings: DEFAULT_SETTINGS,
      marks: null,
    })!;
    expect(target.placement.left).toBeGreaterThanOrEqual(8);
    expect(target.placement.left + narrow.viewport.width - 16).toBeLessThanOrEqual(narrow.viewport.width - 8);
  });

  it("centres a shape's bar on the shape, not off the right edge", () => {
    const wide: Frame = { ...frame, viewport: { width: 1440, height: 900 } };
    const shape = note("s", 0, 0, { type: "shape", shapeKind: "rectangle" });
    const shapeBar = noteBarTarget({ widget: shape, frame: wide, settings: DEFAULT_SETTINGS, marks: null })!;
    const noteBar = noteBarTarget({ widget: note("n", 0, 0), frame: wide, settings: DEFAULT_SETTINGS, marks: null })!;
    expect(shapeBar.placement.left).toBe(720 - 153);
    expect(noteBar.placement.left).toBe(720 - 172);
  });

  it("leaves the tool rail usable when a phone has room for both bars", () => {
    const phone = { ...frame, viewport: { width: 390, height: 900 } };
    const shape = note("s", 0, 0, { type: "shape", shapeKind: "rectangle" });
    const target = noteBarTarget({ widget: shape, frame: phone, settings: DEFAULT_SETTINGS, marks: null })!;
    expect(target.placement.left).toBeGreaterThanOrEqual(72);
    expect(target.placement.left + 296).toBeLessThanOrEqual(phone.viewport.width - 8);
  });

  it("gives a free text object its own kind and its own ink", () => {
    const textWidget = note("t", 0, 0, {
      type: "text",
      style: { color: "#8a35d6" },
    });
    const target = noteBarTarget({
      widget: textWidget,
      frame,
      settings: DEFAULT_SETTINGS,
      marks: null,
    })!;
    expect(target.kind).toBe("text");
    expect(target.textColor).toBe("#8a35d6");
    expect(target.ink).toBe("#8a35d6");
  });

  it("has nothing to show for a connector or a card", () => {
    for (const widget of [connector(0, 0), note("c", 0, 0, { type: "card" })]) {
      expect(
        noteBarTarget({ widget, frame, settings: DEFAULT_SETTINGS, marks: null }),
      ).toBeNull();
    }
  });

  it("marks a locked note as not editable", () => {
    const target = noteBarTarget({
      widget: note("n", 0, 0, { locked: true }),
      frame,
      settings: DEFAULT_SETTINGS,
      marks: null,
    })!;
    expect(target.editable).toBe(false);
  });

  it("shows the ink the painter would draw", () => {
    const light = noteBarTarget({
      widget: note("n", 0, 0, { style: { fillColor: "#ffdd33" } }),
      frame,
      settings: DEFAULT_SETTINGS,
      marks: null,
    })!;
    const dark = noteBarTarget({
      widget: note("d", 0, 0, { style: { fillColor: "#1a1a1a" } }),
      frame,
      settings: DEFAULT_SETTINGS,
      marks: null,
    })!;
    // Ink is derived from the sheet, not from the theme: dark ink on yellow paper,
    // paper on a near-black sheet (ADR-273 §2.2).
    expect(light.ink).toBe("#1e2136");
    expect(dark.ink).toBe("#fbf3df");
  });
});

describe("the arrange bar", () => {
  it("counts two objects as two units", () => {
    const widgets = [note("a", -100, 0), note("b", 100, 0)];
    const target = arrangeBarTarget({
      selectedIds: ["a", "b"],
      frame,
      resolve: resolveWith(widgets),
    })!;
    expect(target.units).toBe(2);
    expect(target.canArrange).toBe(true);
    // A note selection's bar is 304 px wide; the 800 px frame still centres it.
    expect(target.placement.left).toBe(400 - 152);
    // A selection that can turn leaves room for the round handle above its top side.
    expect(target.placement.top).toBe(250 - BAR_ROOM);
    // A kind that never turns keeps the compact room.
    const boards = [
      { ...note("k", -150, 0), type: "kanban" as const, width: 600, height: 400 },
      { ...note("k2", 150, 0), type: "kanban" as const, width: 600, height: 400 },
    ];
    const compact = arrangeBarTarget({
      selectedIds: ["k", "k2"],
      frame,
      resolve: resolveWith(boards),
    })!;
    expect(compact.placement.top).toBe(100 - COMPACT_BAR_ROOM);
  });

  it("names the selection by type, the biggest group first", () => {
    const widgets = [
      note("a", -100, 0),
      note("b", 0, 0),
      note("c", 100, 0),
      note("s", 200, 0, { type: "shape", shapeKind: "rectangle" }),
    ];
    const target = arrangeBarTarget({
      selectedIds: ["a", "b", "c", "s"],
      frame,
      resolve: resolveWith(widgets),
    })!;
    expect(target.objects).toBe(4);
    expect(target.types).toEqual([
      { type: "sticky_note", count: 3 },
      { type: "shape", count: 1 },
    ]);
  });

  it("needs two units: one object or one group is not arrangeable", () => {
    const single = [note("a", 0, 0)];
    expect(
      arrangeBarTarget({ selectedIds: ["a"], frame, resolve: resolveWith(single) }),
    ).toBeNull();

    const grouped = [note("a", -100, 0, { groupId: "g" }), note("b", 0, 0, { groupId: "g" })];
    expect(
      arrangeBarTarget({
        selectedIds: ["a", "b"],
        frame,
        resolve: resolveWith(grouped),
      }),
    ).toBeNull();
  });

  it("counts a group as one unit next to a loose note", () => {
    const widgets = [
      note("a", -100, 0, { groupId: "g" }),
      note("b", 0, 0, { groupId: "g" }),
      note("c", 200, 0),
    ];
    const target = arrangeBarTarget({
      selectedIds: ["a", "b", "c"],
      frame,
      resolve: resolveWith(widgets),
    })!;
    expect(target.units).toBe(2);
    // The name of the selection is the count of objects, not of movable units.
    expect(target.objects).toBe(3);
  });

  it("shows a pair of lines for their shared colour, with nothing to arrange", () => {
    const widgets = [
      connector(0, 0, { id: "l1" }),
      connector(0, 100, { id: "l2" }),
    ];
    const target = arrangeBarTarget({
      selectedIds: ["l1", "l2"],
      frame,
      resolve: resolveWith(widgets),
    })!;
    expect(target.canArrange).toBe(false);
    // A line with no stored colour is Auto, and two Auto lines share that answer.
    expect(target.colour).toEqual({ role: "line", value: "", mixed: false });
  });

  it("ignores cards as units of their own", () => {
    const widgets = [note("c1", 0, 0, { type: "card" }), note("c2", 200, 0, { type: "card" })];
    expect(
      arrangeBarTarget({
        selectedIds: ["c1", "c2"],
        frame,
        resolve: resolveWith(widgets),
      }),
    ).toBeNull();
  });
});

describe("the shared colour role", () => {
  it("is the fill when every selected object paints one", () => {
    expect(commonColour([note("a", 0, 0), note("b", 0, 0)])).toEqual({
      role: "fill",
      value: "#ffdd33",
      mixed: false,
    });
    const mixed = commonColour([
      note("a", 0, 0, { style: { fillColor: "#ffdd33" } }),
      note("b", 0, 0, { type: "shape", style: { fillColor: "#ffffff" } }),
    ])!;
    expect(mixed.role).toBe("fill");
    expect(mixed.mixed).toBe(true);
  });

  it("is absent when the selection mixes a note with a line", () => {
    expect(commonColour([note("a", 0, 0), connector(0, 0)])).toBeNull();
  });
});

describe("the connector bar", () => {
  // The bar is the widest of the floating bars, so it is measured against the design
  // viewport rather than the 800 px test frame it would be pinned inside.
  const wide: Frame = { camera: { x: 0, y: 0, zoom: 1 }, viewport: { width: 1440, height: 900 } };

  it("sits over the line, not over its chord", () => {
    const widgets = [note("a", 0, 0), note("b", 400, 0)];
    const target = connectorBarTarget({
      widget: connector(200, 0),
      frame: wide,
      settings: DEFAULT_SETTINGS,
      resolve: resolveWith(widgets),
    })!;
    // Path centre (720 + 200) minus half of the label-less bar.
    expect(target.placement.left).toBe(920 - 151);
    expect(target.placement.top).toBeLessThan(400);
  });

  it("keeps the toolbar centred when its label controls open in a popover", () => {
    const widgets = [note("a", 0, 0), note("b", 400, 0)];
    const target = connectorBarTarget({
      widget: connector(200, 0, { content: "ok" }),
      frame: wide,
      settings: DEFAULT_SETTINGS,
      resolve: resolveWith(widgets),
    })!;
    expect(target.hasLabel).toBe(true);
    expect(target.placement.left).toBe(920 - 151);
  });

  it.each([
    { zoom: 1, centre: 450, span: 0, side: "above" },
    { zoom: 1.91, centre: 424, span: 0, side: "above" },
    { zoom: 2, centre: 70, span: 0, side: "below" },
    { zoom: 2, centre: 55, span: 600, side: "below" },
    { zoom: 3, centre: 940, span: 0, side: "above" },
  ])("clears the painted label at $zoom×, centre $centre, span $span", ({ zoom, centre, span, side }) => {
    const content = "First line\nSecond line\nThird line";
    // Node has no canvas context. Use the painter's layout with deterministic character widths.
    const metrics = canvas.layoutLabel({ measureText: text => ({ width: text.length * 8 }) }, content, 13);
    const measurement = vi.spyOn(canvas, "labelMetrics").mockReturnValue(metrics);
    try {
      const camera = { x: 0, y: (wide.viewport.height / 2 - centre) / zoom, zoom };
      const target = connectorBarTarget({
        widget: connector(200, 0, { content }),
        frame: { ...wide, camera },
        settings: DEFAULT_SETTINGS,
        resolve: resolveWith([note("a", 0, -span), note("b", 400, span)]),
      })!;
      const top = target.placement.top;
      const shadowBottom = top + 51 + 3;
      expect(top).toBeGreaterThanOrEqual(8);
      expect(shadowBottom).toBeLessThanOrEqual(wide.viewport.height - 8);
      const chipHalfHeight = metrics.height * zoom / 2 + 0.75;
      if (side === "above") expect(centre - chipHalfHeight - shadowBottom).toBeGreaterThanOrEqual(11.99);
      else expect(top - (centre + chipHalfHeight)).toBeGreaterThanOrEqual(11.99);
    } finally {
      measurement.mockRestore();
    }
  });

  it("is absent for a locked line, and for anything that is not a connector", () => {
    const widgets = [note("a", 0, 0), note("b", 400, 0)];
    expect(
      connectorBarTarget({
        widget: connector(200, 0, { locked: true }),
        frame,
        settings: DEFAULT_SETTINGS,
        resolve: resolveWith(widgets),
      }),
    ).toBeNull();
    expect(
      connectorBarTarget({
        widget: note("n", 0, 0),
        frame,
        settings: DEFAULT_SETTINGS,
        resolve: resolveWith(widgets),
      }),
    ).toBeNull();
  });

  it("shows the line's own controls", () => {
    const widgets = [note("a", 0, 0), note("b", 400, 0)];
    const target = connectorBarTarget({
      widget: connector(200, 0, {
        routing: "elbow",
        arrow: "both",
        content: "ok",
        style: { strokeColor: "#e03131", strokeWidth: 4, strokeStyle: "dashed", textColor: "#305bab" },
      }),
      frame,
      settings: DEFAULT_SETTINGS,
      resolve: resolveWith(widgets),
    })!;
    expect(target).toMatchObject({
      routing: "elbow",
      arrow: "both",
      strokeColor: "#e03131",
      strokeWidth: 4,
      strokeStyle: "dashed",
      hasLabel: true,
      ink: "#305bab",
    });
  });
});

describe("the edge continue targets (ADR-195)", () => {
  it("puts four 44 px hit areas on the side midpoints", () => {
    const targets = edgeContinueTargets(note("n", 0, 0), frame);
    expect(targets.map((target) => target.direction).sort()).toEqual([
      "down",
      "left",
      "right",
      "up",
    ]);
    expect(targets.find((target) => target.direction === "right")).toMatchObject({
      left: 458,
      top: 278,
    });
    expect(targets.find((target) => target.direction === "left")).toMatchObject({
      left: 298,
      top: 278,
    });
  });
});
