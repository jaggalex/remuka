import type { TextLine, TextRun, Widget } from "@remo/model";
import { describe, expect, it } from "vitest";
import {
  BLOCK_MIN_LINES,
  blocksClipped,
  blocksHeightFor,
  CHECKBOX_EM,
  fitBlockFont,
  HEADING_SCALE,
  LIST_INDENT_EM,
  layoutTextBlocks,
  layoutWidgetBlocks,
  MARKER_COLUMN_EM,
  MAX_BLOCK_HEIGHT,
  textHitAt,
} from "./textBlocks";
import { lineHeightFor, notePadding } from "./textMetrics";

/** A measuring context that gives every character the same width. */
function fakeCtx(perChar = 8): CanvasRenderingContext2D {
  return {
    font: "",
    textBaseline: "",
    textAlign: "",
    measureText: (text: string) => ({ width: text.length * perChar }),
  } as unknown as CanvasRenderingContext2D;
}

const line = (text: string, extra: Partial<TextLine> = {}): TextLine => ({
  runs: text ? [{ text }] : [],
  indent: 0,
  checked: false,
  ...extra,
});

const marksLine = (runs: TextRun[], extra: Partial<TextLine> = {}): TextLine => ({
  runs,
  indent: 0,
  checked: false,
  ...extra,
});

describe("heading layout", () => {
  it("sets h1 at 1.5 em and h2 at 1.25 em, semibold", () => {
    const layout = layoutTextBlocks(fakeCtx(), [line("Title", { block: "h1" }), line("Sub", { block: "h2" })], {
      width: 400,
      fontPx: 16,
    });
    expect(layout.lines[0]!.fontPx).toBe(16 * HEADING_SCALE.h1);
    expect(layout.lines[1]!.fontPx).toBe(16 * HEADING_SCALE.h2);
    expect(layout.lines[0]!.weight).toBe(600);
    expect(layout.lines[1]!.weight).toBe(600);
    expect(layout.lines[0]!.h).toBe(lineHeightFor(24));
  });

  it("keeps air above a heading that is not first, and less below it", () => {
    const layout = layoutTextBlocks(fakeCtx(), [line("one"), line("Title", { block: "h1" }), line("two")], {
      width: 400,
      fontPx: 16,
    });
    const plain = layoutTextBlocks(fakeCtx(), [line("one"), line("two")], { width: 400, fontPx: 16 });
    // The heading adds a line of its own, 0.4 em above and 0.2 em below, and its line
    // box is taller than a plain one.
    const expected =
      plain.height + lineHeightFor(16) + 16 * 0.4 + 16 * 0.2 + (lineHeightFor(24) - lineHeightFor(16));
    expect(layout.height).toBeCloseTo(expected, 5);
  });

  it("does not put air above the first line of a heading", () => {
    const alone = layoutTextBlocks(fakeCtx(), [line("Title", { block: "h1" })], { width: 400, fontPx: 16 });
    expect(alone.lines[0]!.top).toBe(0);
    expect(alone.height).toBe(lineHeightFor(24));
  });
});

describe("lists and indents", () => {
  it("puts a bullet in a 1.25 em column, 1.5 em per level", () => {
    const layout = layoutTextBlocks(
      fakeCtx(),
      [
        line("top", { block: "bullet" }),
        line("one", { block: "bullet", indent: 1 }),
        line("two", { block: "bullet", indent: 2 }),
      ],
      { width: 400, fontPx: 16 },
    );
    expect(layout.lines.map((entry) => entry.marker.glyph)).toEqual(["•", "◦", "▪"]);
    expect(layout.lines.map((entry) => entry.marker.x)).toEqual([
      0,
      16 * LIST_INDENT_EM,
      2 * 16 * LIST_INDENT_EM,
    ]);
    expect(layout.lines.map((entry) => entry.x)).toEqual([
      16 * MARKER_COLUMN_EM,
      16 * LIST_INDENT_EM + 16 * MARKER_COLUMN_EM,
      2 * 16 * LIST_INDENT_EM + 16 * MARKER_COLUMN_EM,
    ]);
  });

  it("takes the number from linesOf, not from the painter's index", () => {
    const layout = layoutTextBlocks(
      fakeCtx(),
      [
        line("first", { block: "ordered", indent: 0, ordinal: 7 }),
        line("nested", { block: "ordered", indent: 1, ordinal: 1 }),
        line("second", { block: "ordered", indent: 0, ordinal: 8 }),
      ],
      { width: 400, fontPx: 16 },
    );
    expect(layout.lines.map((entry) => entry.marker.glyph)).toEqual(["7.", "1.", "8."]);
    expect(layout.lines.map((entry) => entry.ordinal)).toEqual([7, 1, 8]);
  });

  it("widens the number column by the widest number in its group, and starts a new group", () => {
    const ctx = fakeCtx();
    const layout = layoutTextBlocks(
      ctx,
      [
        line("nine", { block: "ordered", ordinal: 9 }),
        line("ten", { block: "ordered", ordinal: 10 }),
        line("break"),
        line("one", { block: "ordered", ordinal: 1 }),
      ],
      { width: 400, fontPx: 16 },
    );
    const wide = layout.lines[0]!.marker.width;
    const narrow = layout.lines[3]!.marker.width;
    expect(wide).toBeGreaterThan(narrow);
    expect(layout.lines[1]!.marker.width).toBe(wide);
  });

  it("keeps the hanging indent on every wrapped line", () => {
    const text = "слово ".repeat(40).trim();
    const layout = layoutTextBlocks(fakeCtx(), [line(text, { block: "bullet", indent: 1 })], {
      width: 220,
      fontPx: 16,
    });
    expect(layout.lines.length).toBeGreaterThan(2);
    const textX = layout.lines[0]!.x;
    for (const entry of layout.lines) expect(entry.x).toBe(textX);
    // Only the first visual line carries the marker; the rest keep the column empty.
    expect(layout.lines[0]!.marker.kind).toBe("bullet");
    expect(layout.lines[1]!.marker.kind).toBe("none");
  });

  it("wraps words with their marks instead of splitting a bold word", () => {
    const layout = layoutTextBlocks(
      fakeCtx(),
      [marksLine([{ text: "plain " }, { text: "bold", bold: true }, { text: " tail" }])],
      { width: 1000, fontPx: 16 },
    );
    expect(layout.lines[0]!.runs.map((run) => run.text).join("")).toBe("plain bold tail");
    expect(layout.lines[0]!.runs.some((run) => run.marks.bold)).toBe(true);
  });
});

describe("checklists", () => {
  it("carries the checked state and draws a square marker", () => {
    const layout = layoutTextBlocks(
      fakeCtx(),
      [
        line("done", { block: "check", checked: true }),
        line("todo", { block: "check", checked: false }),
      ],
      { width: 300, fontPx: 16 },
    );
    expect(layout.lines.map((entry) => entry.marker.kind)).toEqual(["check", "check"]);
    expect(layout.lines.map((entry) => entry.marker.checked)).toEqual([true, false]);
    // The square is 0.8 em inside the 1.25 em column.
    expect(16 * CHECKBOX_EM).toBeLessThan(16 * MARKER_COLUMN_EM);
  });
});

describe("alignment", () => {
  it("shifts the block as a whole so markers keep their indent", () => {
    const ctx = fakeCtx();
    const left = layoutTextBlocks(ctx, [line("one", { block: "bullet" })], {
      width: 200,
      fontPx: 16,
      align: "left",
    });
    const centre = layoutTextBlocks(ctx, [line("one", { block: "bullet" })], {
      width: 200,
      fontPx: 16,
      align: "center",
    });
    const shift = centre.lines[0]!.x - left.lines[0]!.x;
    expect(centre.lines[0]!.marker.x - left.lines[0]!.marker.x).toBe(shift);
    expect(shift).toBeGreaterThan(0);
  });
});

describe("height and fit", () => {
  it("never asks for less than the three lines a note keeps", () => {
    const height = blocksHeightFor([line("short")], 200, 16, "sans", fakeCtx());
    expect(height).toBe(lineHeightFor(16) * BLOCK_MIN_LINES);
  });

  it("grows with the content and stops at the shape cap", () => {
    const many = Array.from({ length: 400 }, (_, index) => line(`line ${index}`));
    const height = blocksHeightFor(many, 200, 16, "sans", fakeCtx());
    expect(height).toBe(MAX_BLOCK_HEIGHT);
  });

  it("fits a smaller em when a heading makes the block taller", () => {
    const plain = fitBlockFont(fakeCtx(), [line("word ".repeat(20))], 200, 200, 16, 8, "sans");
    const heading = fitBlockFont(fakeCtx(), [line("word ".repeat(20), { block: "h1" })], 200, 200, 16, 8, "sans");
    expect(heading).toBeLessThanOrEqual(plain);
  });

  it("reports clipped when the block is taller than its box", () => {
    const widget = {
      id: "w",
      type: "sticky_note",
      x: 0,
      y: 0,
      width: 200,
      height: 60,
      style: { fontSize: 16 },
      lines: [line("one"), line("two"), line("three"), line("four"), line("five")],
    } as unknown as Widget;
    expect(blocksClipped(widget, 16, "sans", fakeCtx())).toBe(true);
    expect(blocksClipped({ ...widget, height: 300 } as Widget, 16, "sans", fakeCtx())).toBe(false);
    expect(blocksClipped(widget, 16, "sans", null)).toBeNull();
  });
});

describe("hit test", () => {
  const widget = (lines: TextLine[], height = 240): Widget =>
    ({
      id: "w",
      type: "sticky_note",
      x: 0,
      y: 0,
      width: 260,
      height,
      style: { fontSize: 16 },
      lines,
    }) as unknown as Widget;

  /** The layout the painter uses for the same widget and box. */
  function geometry(subject: Widget) {
    const ctx = fakeCtx();
    const box = {
      x: subject.x - subject.width / 2,
      y: subject.y - subject.height / 2,
      width: subject.width,
      height: subject.height,
    };
    const measured = layoutWidgetBlocks(ctx, subject, box, 16, "sans");
    if (!measured) throw new Error("no block layout");
    return { ctx, measured };
  }

  it("finds the checkbox marker of the line, not the text beside it", () => {
    const subject = widget([
      line("first", { block: "check", checked: false }),
      line("second", { block: "check", checked: true }),
    ]);
    const { ctx, measured } = geometry(subject);
    const target = measured.layout.lines[1]!;
    const point = {
      x: measured.contentX + target.marker.x + target.marker.width / 2,
      y: measured.contentY + target.top + target.h / 2,
    };
    expect(textHitAt(subject, point, { ctx, cap: 16, family: "sans" })).toEqual({
      kind: "checkbox",
      line: 1,
    });
  });

  it("lets a click in the words fall through to the ordinary behaviour", () => {
    const subject = widget([line("first", { block: "check" })]);
    const { ctx, measured } = geometry(subject);
    const target = measured.layout.lines[0]!;
    const point = {
      x: measured.contentX + target.x + target.width + 40,
      y: measured.contentY + target.top + target.h / 2,
    };
    expect(textHitAt(subject, point, { ctx, cap: 16, family: "sans" })).toBeNull();
  });

  it("reports a link with its href and character range", () => {
    const subject = widget([
      marksLine([{ text: "see " }, { text: "docs", href: "https://example.com/docs" }, { text: " now" }]),
    ]);
    const { ctx, measured } = geometry(subject);
    const target = measured.layout.lines[0]!;
    const link = target.runs.find((run) => run.marks.href)!;
    const point = { x: measured.contentX + link.x + 2, y: measured.contentY + target.top + target.h / 2 };
    const hit = textHitAt(subject, point, { ctx, cap: 16, family: "sans" });
    expect(hit).toMatchObject({
      kind: "link",
      href: "https://example.com/docs",
      range: { line: 0, from: 4, to: 8 },
    });
  });

  it("has nothing to find on text without line formats", () => {
    const plain = { ...widget([]), lines: undefined, content: "plain" } as Widget;
    expect(textHitAt(plain, { x: 0, y: 0 }, { ctx: fakeCtx(), cap: 16 })).toBeNull();
  });
});

describe("padding and the box", () => {
  it("places the first line at the padding the painter uses", () => {
    const subject = {
      id: "w",
      type: "shape",
      x: 0,
      y: 0,
      width: 240,
      height: 160,
      style: { fontSize: 16 },
      lines: [line("one")],
    } as unknown as Widget;
    const box = { x: -120, y: -80, width: 240, height: 160 };
    const measured = layoutWidgetBlocks(fakeCtx(), subject, box, 16, "sans", {
      align: "left",
      vAlign: "top",
    })!;
    expect(measured.padding).toBe(notePadding(16));
    expect(measured.contentX).toBe(box.x + notePadding(16));
    expect(measured.contentY).toBe(box.y + notePadding(16));
  });
});
