import type { Widget } from "@remo/model";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_THEME, deviceScale, drawWidget } from "./render";

/**
 * A 2D context stand-in: every method is a recorded no-op, every property is writable,
 * and the methods named in `failing` throw — the way a painter fails on a value it did
 * not expect.
 */
function fakeContext(failing: string[] = []) {
  const calls: string[] = [];
  const texts: string[] = [];
  const fillStyles: string[] = [];
  const strokeStyles: string[] = [];
  const fonts: string[] = [];
  const state: Record<string | symbol, unknown> = {};
  const ctx = new Proxy(state, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === "measureText") return () => ({ width: 10 });
      return (...args: unknown[]) => {
        calls.push(String(key));
        if (key === "fillText" && typeof args[0] === "string") texts.push(args[0]);
        if (failing.includes(String(key))) throw new Error(`${String(key)} failed`);
        return undefined;
      };
    },
    set(target, key, value) {
      if (key === "fillStyle" && typeof value === "string") fillStyles.push(value);
      if (key === "strokeStyle" && typeof value === "string") strokeStyles.push(value);
      if (key === "font" && typeof value === "string") fonts.push(value);
      target[key] = value;
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, texts, state, fillStyles, strokeStyles, fonts };
}

const shape: Widget = {
  id: "s1",
  type: "unsupported",
  parentId: null,
  x: 0,
  y: 0,
  width: 100,
  height: 100,
};

describe("drawWidget isolation (ADR-171)", () => {
  it("keeps one failing widget from breaking the frame", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { ctx, calls } = fakeContext(["strokeRect"]);

    expect(() => drawWidget(ctx, shape, 1)).not.toThrow();
    // The canvas state is restored, so the next widget paints with a clean context.
    expect(calls[0]).toBe("save");
    expect(calls.at(-1)).toBe("restore");

    // Reported once per object, not once per frame.
    drawWidget(ctx, shape, 1);
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it("paints a healthy widget inside one save/restore pair", () => {
    const { ctx, calls } = fakeContext();
    drawWidget(ctx, shape, 1);
    expect(calls.filter((c) => c === "save").length).toBe(
      calls.filter((c) => c === "restore").length,
    );
    expect(calls).toContain("strokeRect");
  });
});

describe("the frame's name is canvas content (ADR-267 §2)", () => {
  it("paints the label plate above the frame, in the same drawWidget export uses", () => {
    const { ctx, fillStyles, texts } = fakeContext();
    drawWidget(
      ctx,
      {
        id: "f1",
        type: "frame",
        parentId: null,
        x: 0,
        y: 0,
        width: 600,
        height: 400,
        title: "Спринт",
      },
      1,
    );
    expect(texts).toContain("Спринт");
    expect(fillStyles).toContain(DEFAULT_THEME.palette.objectInk);
    expect(fillStyles).toContain(DEFAULT_THEME.palette.objectPaper);
  });

  it("paints no plate for an unnamed frame", () => {
    const { ctx, fillStyles } = fakeContext();
    drawWidget(
      ctx,
      { id: "f2", type: "frame", parentId: null, x: 0, y: 0, width: 600, height: 400 },
      1,
    );
    expect(fillStyles).not.toContain(DEFAULT_THEME.palette.objectPaper);
  });
});

describe("the timer object is cardboard (ADR-267 §2)", () => {
  const timer = (remainingMs: number): Widget => ({
    id: "t1",
    type: "timer",
    parentId: null,
    x: 0,
    y: 0,
    width: 240,
    height: 128,
    timer: {
      durationMs: 60_000,
      endsAt: null,
      remainingMs,
      state: "paused",
      setBy: "Alex",
    },
  });

  it("is white paper with an ink edge, a hard 3-unit shadow and 800 digits", () => {
    const { ctx, fillStyles, strokeStyles, fonts } = fakeContext();
    drawWidget(ctx, timer(45_000), 1);
    expect(fillStyles).toContain(DEFAULT_THEME.palette.objectInk);
    expect(fillStyles).toContain("#ffffff");
    expect(strokeStyles).toContain(DEFAULT_THEME.palette.objectInk);
    expect(fonts.some((font) => font.startsWith("800 "))).toBe(true);
    expect(fillStyles).not.toContain(DEFAULT_THEME.palette.dangerInk);
  });

  it("turns its digits danger-ink in the last ten seconds", () => {
    const { ctx, fillStyles } = fakeContext();
    drawWidget(ctx, timer(9_000), 1);
    expect(fillStyles).toContain(DEFAULT_THEME.palette.dangerInk);
  });
});

describe("deviceScale (ADR-181 sticky shadow)", () => {
  it("reads the canvas matrix, so the shadow follows zoom and device pixel ratio", () => {
    const ctx = { getTransform: () => ({ a: 3, b: 0 }) } as unknown as CanvasRenderingContext2D;
    expect(deviceScale(ctx, 1.5)).toBe(3);
  });

  it("falls back to the zoom when the context cannot report its matrix", () => {
    expect(deviceScale({} as CanvasRenderingContext2D, 1.5)).toBe(1.5);
  });
});

describe("inline editing and the canvas (ADR-033)", () => {
  const textWidget: Widget = {
    id: "t1",
    type: "text",
    parentId: null,
    x: 50,
    y: 50,
    width: 200,
    height: 80,
    content: "hello",
    style: { fontSize: 16 },
  };

  it("draws the text when nobody is editing it", () => {
    const { ctx, calls } = fakeContext();
    drawWidget(ctx, textWidget, 1);
    expect(calls).toContain("fillText");
  });

  it("leaves the text to the DOM editor, so it cannot be painted twice", () => {
    const { ctx, calls } = fakeContext();
    drawWidget(ctx, textWidget, 1, { editingId: "t1" });
    expect(calls).not.toContain("fillText");
  });
});

/**
 * Block text on a text object (ADR-252 §7): the painter goes through the block layout,
 * so a numbered line keeps the number `linesOf` computed and a checklist draws its box.
 */
describe("block text on the canvas (ADR-252)", () => {
  const blocks: Widget = {
    id: "b1",
    type: "text",
    parentId: null,
    x: 100,
    y: 100,
    width: 260,
    height: 220,
    content: "Title\nFirst\nDone",
    style: { fontSize: 16 },
    lines: [
      { runs: [{ text: "Title" }], block: "h1", indent: 0, checked: false },
      { runs: [{ text: "First" }], block: "ordered", indent: 0, checked: false, ordinal: 7 },
      { runs: [{ text: "Done" }], block: "check", indent: 0, checked: true },
    ],
  };

  it("draws the heading, the number and the checklist marker", () => {
    const { ctx, calls, texts } = fakeContext();
    drawWidget(ctx, blocks, 1);
    expect(texts).toContain("Title");
    expect(texts).toContain("First");
    expect(texts).toContain("Done");
    // The ordinal comes from the line, not from the painter's row index.
    expect(texts).toContain("7.");
    // An unchecked box is stroked; a checked one is filled and carries the tick.
    expect(calls).toContain("stroke");
    expect(calls).toContain("fill");
    expect(texts).toContain("✓");
  });

  it("leaves the text to the editor, as the inline path does", () => {
    const { ctx, calls } = fakeContext();
    drawWidget(ctx, blocks, 1, { editingId: "b1" });
    expect(calls).not.toContain("fillText");
  });
});

describe("images on the canvas (ADR-249)", () => {  const imageWidget = {
    id: "i1",
    type: "image",
    parentId: null,
    x: 100,
    y: 100,
    width: 200,
    height: 100,
    fileId: "f1",
    naturalWidth: 800,
    naturalHeight: 400,
    dominantColor: "#336699",
  } as unknown as Widget;

  it("draws the bitmap the app hands over", () => {
    const { ctx, calls } = fakeContext();
    const bitmap = { width: 800, height: 400 } as unknown as ImageBitmap;
    drawWidget(ctx, imageWidget, 1, { image: () => bitmap });
    expect(calls).toContain("drawImage");
  });

  it("paints the dominant colour while the bitmap is missing", () => {
    const { ctx, calls, fillStyles } = fakeContext();
    drawWidget(ctx, imageWidget, 1, { image: () => null });
    expect(calls).toContain("fill");
    expect(calls).not.toContain("drawImage");
    expect(fillStyles[0]).toBe("#336699");
  });

  it("paints the unavailable sentence for a failed file", () => {
    const { ctx, calls } = fakeContext();
    drawWidget(ctx, imageWidget, 1, {
      image: () => null,
      imageUnavailable: () => true,
      theme: { ...DEFAULT_THEME, imageUnavailable: "No picture" },
    });
    const text = calls.filter((call) => call === "fillText");
    expect(text.length).toBeGreaterThan(0);
  });
});

describe("sticky note tilt (ADR-265)", () => {
  it("is one of the six tilts and the same for the same id", async () => {
    const { stickyTilt, STICKY_TILTS } = await import("./stickyPaint");
    for (const id of ["a", "note-1", "0b2f", "Ромашка"]) {
      expect(STICKY_TILTS).toContain(stickyTilt(id));
      expect(stickyTilt(id)).toBe(stickyTilt(id));
    }
    const spread = new Set(Array.from({ length: 60 }, (_, i) => stickyTilt(`n${i}`)));
    expect(spread.size).toBe(STICKY_TILTS.length);
  });
});

describe("paper in the hand (ADR-265 §4.2)", () => {
  /** A context that records each method with its arguments, in order. */
  function rec() {
    const calls: Array<{ name: string; args: unknown[] }> = [];
    const state: Record<string | symbol, unknown> = {};
    const ctx = new Proxy(state, {
      get(target, key) {
        if (key in target) return target[key];
        if (key === "measureText") return () => ({ width: 10 });
        if (key === "createLinearGradient") return () => ({ addColorStop() {} });
        return (...args: unknown[]) => {
          calls.push({ name: String(key), args });
        };
      },
      set(target, key, value) {
        target[key] = value;
        return true;
      },
    });
    return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
  }

  const note: Widget = {
    id: "sticky_paper",
    type: "sticky_note",
    parentId: null,
    x: 0,
    y: 0,
    width: 160,
    height: 180,
  };
  const named = (calls: Array<{ name: string; args: unknown[] }>, name: string) =>
    calls.filter((call) => call.name === name).map((call) => call.args);

  it("lifts, grows and straightens a hovered note", () => {
    const { ctx, calls } = rec();
    drawWidget(ctx, note, 1, { hand: 1 });
    expect(named(calls, "scale")).toContainEqual([1.03, 1.03]);
    expect(named(calls, "rotate")).toEqual([]);
  });

  it("keeps the note's own tilt at rest and halfway up it is halfway straight", () => {
    const atRest = rec();
    drawWidget(atRest.ctx, note, 1);
    expect(named(atRest.calls, "rotate").length).toBe(1);

    const half = rec();
    drawWidget(half.ctx, note, 1, { hand: 0.5 });
    const tilt = named(atRest.calls, "rotate")[0]![0] as number;
    expect(named(half.calls, "rotate")[0]![0]).toBeCloseTo(tilt / 2, 6);
    expect(named(half.calls, "scale")).toContainEqual([1.015, 1.015]);
  });
});
