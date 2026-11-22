import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import type { TextDeltaOp, Widget } from "@remo/model";
import {
  BoardDocument,
  canonicalAttributes,
  canonicalLineFormat,
  clearNoteMarks,
  clearTextFormatting,
  createWidget,
  deltaOf,
  linesOf,
  normalizeDelta,
  plainOf,
  setLineFormat,
  setWidgetDelta,
} from "./board";

/**
 * The model half of text v2 (ADR-252 §2): attributes, the one line reader and the cheap
 * line-format command. No painter and no editor take part in these tests.
 */

const note = (id = "n", type: Widget["type"] = "sticky_note"): Widget => ({
  id,
  type,
  parentId: null,
  x: 0,
  y: 0,
  width: 200,
  height: 200,
});

function boardWith(type: Widget["type"] = "sticky_note"): BoardDocument {
  const board = new BoardDocument();
  createWidget(board, note("n", type));
  return board;
}

/** A delta built from a compact line table. */
function deltaOfLines(
  lines: Array<{
    text: string;
    block?: "h1" | "h2" | "bullet" | "ordered" | "check";
    indent?: 1 | 2;
    checked?: boolean;
    marks?: Record<string, unknown>;
  }>,
): TextDeltaOp[] {
  const out: TextDeltaOp[] = [];
  lines.forEach((line, index) => {
    // A block line already ends with its own newline; only a plain previous line
    // needs the ordinary separator.
    if (index > 0 && !lines[index - 1]!.block) out.push({ insert: "\n" });
    if (line.text) out.push({ insert: line.text, attributes: line.marks });
    if (line.block) {
      out.push({
        insert: "\n",
        attributes: {
          block: line.block,
          ...(line.indent ? { indent: line.indent } : {}),
          ...(line.checked ? { checked: true } : {}),
        },
      });
    }
  });
  return out;
}

describe("canonicalAttributes (ADR-252 §2.3)", () => {
  it("keeps all six inline marks, including code and a safe link", () => {
    expect(
      canonicalAttributes({
        insert: "x",
        attributes: {
          bold: true,
          italic: true,
          underline: true,
          strike: true,
          code: true,
          href: "https://example.com",
        },
      }),
    ).toEqual({
      bold: true,
      italic: true,
      underline: true,
      strike: true,
      code: true,
      href: "https://example.com/",
    });
    expect(canonicalAttributes({ insert: "x", attributes: { code: false } })).toEqual({});
  });

  it("drops line formats from an ordinary character", () => {
    expect(
      canonicalAttributes({
        insert: "x",
        attributes: { bold: true, block: "h1", indent: 2, checked: true },
      }),
    ).toEqual({ bold: true });
  });

  it("drops inline marks from the newline that ends a line", () => {
    expect(
      canonicalAttributes({
        insert: "\n",
        attributes: { bold: true, href: "https://example.com/", block: "bullet", indent: 2 },
      }),
    ).toEqual({ block: "bullet", indent: 2 });
  });

  it("keeps only the formats the model defines", () => {
    for (const block of ["h1", "h2", "bullet", "ordered", "check"] as const) {
      expect(canonicalLineFormat({ block })).toEqual({ block });
    }
    expect(canonicalLineFormat({ block: "quote" as never })).toEqual({});
    // Indent belongs to lists; checked belongs to a checklist line.
    expect(canonicalLineFormat({ block: "h1", indent: 2 })).toEqual({ block: "h1" });
    expect(canonicalLineFormat({ block: "bullet", indent: 3 as never })).toEqual({ block: "bullet" });
    expect(canonicalLineFormat({ block: "check", checked: false })).toEqual({ block: "check" });
    expect(canonicalLineFormat({ block: "check", checked: true })).toEqual({
      block: "check",
      checked: true,
    });
    expect(canonicalLineFormat({ indent: 2 })).toEqual({});
  });

  it("never lets an address the product cannot open through", () => {
    for (const href of [
      "javascript:alert(1)",
      "data:text/html,x",
      "file:///etc/passwd",
      "https://u:p@example.com",
      "https://example.com/" + "a".repeat(2050),
    ]) {
      expect(canonicalAttributes({ insert: "x", attributes: { href } })).toEqual({});
    }
    expect(canonicalAttributes({ insert: "x", attributes: { href: "mailto:a@b.example" } })).toEqual({
      href: "mailto:a@b.example",
    });
  });
});

describe("linesOf (ADR-252 §2.2)", () => {
  it("reads an old delta as one line with its old marks", () => {
    const lines = linesOf([
      { insert: "one ", attributes: { bold: true } },
      { insert: "two" },
    ]);
    expect(lines).toEqual([
      {
        runs: [
          { text: "one ", bold: true },
          { text: "two" },
        ],
        indent: 0,
        checked: false,
      },
    ]);
  });

  it("merges adjacent runs with the same marks", () => {
    const lines = linesOf([
      { insert: "a", attributes: { bold: true } },
      { insert: "b", attributes: { bold: true } },
      { insert: "c" },
    ]);
    expect(lines[0]!.runs).toEqual([{ text: "ab", bold: true }, { text: "c" }]);
  });

  it("does not count the terminating newline of a formatted last line as empty", () => {
    const lines = linesOf([
      { insert: "Title" },
      { insert: "\n", attributes: { block: "h1" } },
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ block: "h1", indent: 0, checked: false });
    expect(lines[0]!.runs).toEqual([{ text: "Title" }]);
    // A plain trailing newline keeps its old meaning: a second, empty line.
    expect(linesOf([{ insert: "Title\n" }])).toHaveLength(2);
  });

  it("reads middle lines and empty lines", () => {
    const lines = linesOf([
      { insert: "a" },
      { insert: "\n", attributes: { block: "h2" } },
      { insert: "\n" },
      { insert: "b" },
    ]);
    expect(lines.map((line) => [line.block, line.runs.map((run) => run.text).join("")])).toEqual([
      ["h2", "a"],
      [undefined, ""],
      [undefined, "b"],
    ]);
  });

  it("numbers ordered lists per level and restarts on a break", () => {
    const lines = linesOf(
      deltaOfLines([
        { text: "one", block: "ordered" },
        { text: "child", block: "ordered", indent: 1 },
        { text: "child", block: "ordered", indent: 1 },
        { text: "two", block: "ordered" },
        { text: "child", block: "ordered", indent: 1 },
        { text: "note" },
        { text: "one again", block: "ordered" },
        { text: "bullet", block: "bullet" },
        { text: "one after bullet", block: "ordered" },
      ]),
    );
    expect(lines.map((line) => line.ordinal)).toEqual([
      1, 1, 2, 2, 1, undefined, 1, undefined, 1,
    ]);
  });

  it("lets a deeper line keep its parent's numbering", () => {
    const lines = linesOf(
      deltaOfLines([
        { text: "one", block: "ordered" },
        { text: "deeper", block: "ordered", indent: 2 },
        { text: "still one", block: "ordered" },
      ]),
    );
    expect(lines.map((line) => line.ordinal)).toEqual([1, 1, 2]);
  });

  it("keeps the checklist state and drops an unknown format", () => {
    const lines = linesOf([
      { insert: "done" },
      { insert: "\n", attributes: { block: "check", checked: true } },
      { insert: "later" },
      { insert: "\n", attributes: { block: "quote" as never } },
    ]);
    expect(lines[0]).toMatchObject({ block: "check", checked: true });
    expect(lines[1]).toMatchObject({ checked: false });
    expect(lines[1]!.block).toBeUndefined();
  });
});

describe("normalizeDelta with line formats", () => {
  it("keeps a line format on its own newline", () => {
    expect(
      normalizeDelta([{ insert: "a\nb", attributes: { block: "h1", bold: true } }]),
    ).toEqual([
      { insert: "a", attributes: { bold: true } },
      { insert: "\n", attributes: { block: "h1" } },
      { insert: "b", attributes: { bold: true } },
    ]);
  });

  it("is idempotent", () => {
    const delta = normalizeDelta([
      { insert: "a", attributes: { bold: true, block: "h1" } },
      { insert: "\n", attributes: { block: "h1", bold: true } },
      { insert: "b" },
    ]);
    expect(normalizeDelta(delta)).toEqual(delta);
  });
});

describe("setWidgetDelta with line formats", () => {
  it("keeps code and a safe link on characters", () => {
    const board = boardWith();
    setWidgetDelta(board, "n", [
      { insert: "let ", attributes: { code: true } },
      { insert: "unsafe", attributes: { href: "javascript:alert(1)" } },
      { insert: " link", attributes: { href: "https://example.com" } },
    ]);
    expect(board.snapshot().widgets[0]!.runs).toEqual([
      { text: "let ", code: true },
      { text: "unsafe" },
      { text: " link", href: "https://example.com/" },
    ]);
  });

  it("formats a line through the editor's whole-delta path", () => {
    const board = boardWith();
    setWidgetDelta(board, "n", [
      { insert: "Title" },
      { insert: "\n", attributes: { block: "h1" } },
    ]);
    expect(plainOf(board.texts.get("n")!)).toBe("Title\n");
    expect(board.snapshot().widgets[0]!.lines).toEqual([
      { runs: [{ text: "Title" }], block: "h1", indent: 0, checked: false },
    ]);
    // No inline marks: the run list stays absent and the plain path is untouched.
    expect(board.snapshot().widgets[0]!.runs).toBeUndefined();
  });

  it("merges a format-only change as one character", () => {
    const board = boardWith();
    setWidgetDelta(board, "n", [{ insert: "a\nb" }]);
    board.stopCapturing();
    const depth = board.undo.undoStack.length;

    const next: TextDeltaOp[] = [
      { insert: "a" },
      { insert: "\n", attributes: { block: "h1" } },
      { insert: "b" },
    ];
    setWidgetDelta(board, "n", next);
    expect(normalizeDelta(deltaOf(board.texts.get("n")!))).toEqual(next);
    board.undoOnce();
    expect(deltaOf(board.texts.get("n")!)).toEqual([{ insert: "a\nb" }]);
    expect(board.undo.undoStack.length).toBe(depth);
  });
});

describe("setLineFormat (ADR-252 §2.3)", () => {
  it("gives the last line a terminating newline in the same transaction", () => {
    const board = boardWith();
    setWidgetDelta(board, "n", [{ insert: "Title" }]);
    board.stopCapturing();
    const depth = board.undo.undoStack.length;

    setLineFormat(board, "n", 0, { block: "h1" });
    expect(deltaOf(board.texts.get("n")!)).toEqual([
      { insert: "Title" },
      { insert: "\n", attributes: { block: "h1" } },
    ]);
    expect(linesOf(board.deltaOf("n")).map((line) => line.block)).toEqual(["h1"]);

    // One command, one undo step; it returns exactly to the plain value.
    board.undoOnce();
    expect(deltaOf(board.texts.get("n")!)).toEqual([{ insert: "Title" }]);
    expect(board.undo.undoStack.length).toBe(depth);
  });

  it("clears a last line by removing the terminator it added", () => {
    const board = boardWith();
    setWidgetDelta(board, "n", [{ insert: "Title" }]);
    setLineFormat(board, "n", 0, { block: "h1" });
    setLineFormat(board, "n", 0, null);
    expect(deltaOf(board.texts.get("n")!)).toEqual([{ insert: "Title" }]);
    expect(board.snapshot().widgets[0]!.lines).toBeUndefined();
  });

  it("formats one newline in the middle and leaves the text alone", () => {
    const board = boardWith();
    setWidgetDelta(board, "n", [{ insert: "one\ntwo\nthree" }]);
    setLineFormat(board, "n", 1, { block: "bullet", indent: 1 });
    expect(normalizeDelta(deltaOf(board.texts.get("n")!))).toEqual([
      { insert: "one\ntwo" },
      { insert: "\n", attributes: { block: "bullet", indent: 1 } },
      { insert: "three" },
    ]);
    expect(plainOf(board.texts.get("n")!)).toBe("one\ntwo\nthree");
  });

  it("toggles a checklist item without touching its text", () => {
    const board = boardWith();
    setWidgetDelta(board, "n", [
      { insert: "task" },
      { insert: "\n", attributes: { block: "check" } },
    ]);
    setLineFormat(board, "n", 0, { block: "check", checked: true });
    expect(linesOf(board.deltaOf("n"))[0]).toMatchObject({ block: "check", checked: true });
    setLineFormat(board, "n", 0, { block: "check", checked: false });
    expect(linesOf(board.deltaOf("n"))[0]).toMatchObject({ block: "check", checked: false });
    expect(plainOf(board.texts.get("n")!)).toBe("task\n");
  });

  it("ignores an unknown format instead of clearing a line", () => {
    const board = boardWith();
    setWidgetDelta(board, "n", [
      { insert: "Title" },
      { insert: "\n", attributes: { block: "h1" } },
    ]);
    setLineFormat(board, "n", 0, { block: "quote" as never });
    setLineFormat(board, "n", 0, { indent: 2 });
    expect(linesOf(board.deltaOf("n"))[0]!.block).toBe("h1");
  });

  it("refuses a card and a connector label, as the kind table says", () => {
    for (const type of ["card", "connector"] as const) {
      const board = boardWith(type);
      setWidgetTextFor(board, "n", "label");
      setLineFormat(board, "n", 0, { block: "h1" });
      expect(linesOf(board.deltaOf("n"))[0]!.block).toBeUndefined();
    }
  });

  it("does nothing for a line that does not exist", () => {
    const board = boardWith();
    setWidgetDelta(board, "n", [{ insert: "one" }]);
    setLineFormat(board, "n", 4, { block: "h1" });
    expect(deltaOf(board.texts.get("n")!)).toEqual([{ insert: "one" }]);
  });
});

/** The plain text command is enough here; the editor is not part of this stage. */
function setWidgetTextFor(board: BoardDocument, id: string, text: string): void {
  const shared = new Y.Text();
  shared.insert(0, text);
  board.texts.set(id, shared);
}

describe("compatibility: an old document survives the new model", () => {
  it("converges when one client types and another changes the line format", () => {
    const a = boardWith();
    // Once a note is rich text (as any formatted note is), both commands address the
    // same `Y.XmlText`; the first mark upgrades a plain value, exactly as before.
    setWidgetDelta(a, "n", [
      { insert: "one", attributes: { bold: true } },
      { insert: "\ntwo\nthree" },
    ]);
    const b = new BoardDocument();
    Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc));

    // Offline on both sides: one person types at the end of the text, the other turns
    // the middle line into a bullet. Neither sends the whole delta.
    a.stopCapturing();
    b.stopCapturing();
    setWidgetDelta(a, "n", [
      { insert: "one", attributes: { bold: true } },
      { insert: "\ntwo\nthree!" },
    ]);
    setLineFormat(b, "n", 1, { block: "bullet" });

    const updateA = Y.encodeStateAsUpdate(a.doc);
    const updateB = Y.encodeStateAsUpdate(b.doc);
    Y.applyUpdate(b.doc, updateA);
    Y.applyUpdate(a.doc, updateB);

    for (const board of [a, b]) {
      expect(plainOf(board.texts.get("n")!)).toBe("one\ntwo\nthree!");
      expect(linesOf(board.deltaOf("n")).map((line) => line.block)).toEqual([
        undefined,
        "bullet",
        undefined,
      ]);
    }
  });

  it("keeps the old delta, its runs and the absence of lines", () => {
    const board = boardWith();
    const old: TextDeltaOp[] = [
      { insert: "hello ", attributes: { bold: true } },
      { insert: "world" },
    ];
    setWidgetDelta(board, "n", old);

    const widget = board.snapshot().widgets[0]!;
    expect(widget.content).toBe("hello world");
    expect(widget.runs).toEqual([
      { text: "hello ", bold: true },
      { text: "world" },
    ]);
    expect(widget.lines).toBeUndefined();
    // Reading and writing the same plain delta through the new canonical form is a
    // fixed point: no migration, no second representation.
    expect(normalizeDelta(deltaOf(board.texts.get("n")!))).toEqual(old);
  });

  it("round-trips old text through a line format and back to the same delta", () => {
    const board = boardWith();
    const old: TextDeltaOp[] = [{ insert: "a\nb" }, { insert: "c", attributes: { italic: true } }];
    setWidgetDelta(board, "n", old);
    expect(normalizeDelta(deltaOf(board.texts.get("n")!))).toEqual(old);

    setLineFormat(board, "n", 1, { block: "ordered" });
    expect(linesOf(board.deltaOf("n")).map((line) => line.block)).toEqual([undefined, "ordered"]);

    setLineFormat(board, "n", 1, null);
    expect(normalizeDelta(deltaOf(board.texts.get("n")!))).toEqual(old);
  });

  it("clearNoteMarks keeps the line formats; clearTextFormatting removes both", () => {
    const board = boardWith();
    setWidgetDelta(board, "n", [
      { insert: "top", attributes: { bold: true } },
      { insert: "\n", attributes: { block: "h1" } },
      { insert: "item", attributes: { italic: true } },
      { insert: "\n", attributes: { block: "check", checked: true } },
    ]);

    // "Clear the marks" is not "clear the structure": a heading stays a heading.
    clearNoteMarks(board, ["n"]);
    expect(linesOf(board.deltaOf("n")).map((line) => [line.block, line.runs[0]?.bold])).toEqual([
      ["h1", undefined],
      ["check", undefined],
    ]);

    setWidgetDelta(board, "n", [
      { insert: "top", attributes: { bold: true } },
      { insert: "\n", attributes: { block: "h1" } },
      { insert: "item", attributes: { italic: true } },
      { insert: "\n", attributes: { block: "check", checked: true } },
    ]);
    // The bar's "Clear formatting" (⌘\) is the whole answer: no marks, no blocks.
    clearTextFormatting(board, ["n"]);
    expect(linesOf(board.deltaOf("n")).map((line) => line.block)).toEqual([
      undefined,
      undefined,
    ]);
    expect(linesOf(board.deltaOf("n")).every((line) => line.runs.every((run) => !run.bold && !run.italic))).toBe(
      true,
    );
  });
});
