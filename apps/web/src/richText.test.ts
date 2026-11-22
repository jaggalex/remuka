import { describe, expect, it } from "vitest";
import type { TextDeltaOp } from "@remo/model";
import {
  deltaText,
  lineFormatFor,
  lineKeyAction,
  markdownShortcut,
  pasteDelta,
} from "./richText";

const textOf = (delta: TextDeltaOp[]): string => delta.map((op) => op.insert).join("");

describe("markdownShortcut (ADR-252 §5.2)", () => {
  it("turns a marker typed at the start of a line into a block", () => {
    expect(markdownShortcut("# ")).toEqual({ remove: 2, block: "h1" });
    expect(markdownShortcut("## ")).toEqual({ remove: 3, block: "h2" });
    expect(markdownShortcut("- ")).toEqual({ remove: 2, block: "bullet" });
    expect(markdownShortcut("* ")).toEqual({ remove: 2, block: "bullet" });
    expect(markdownShortcut("+ ")).toEqual({ remove: 2, block: "bullet" });
    expect(markdownShortcut("1. ")).toEqual({ remove: 3, block: "ordered" });
    expect(markdownShortcut("12) ")).toEqual({ remove: 4, block: "ordered" });
    expect(markdownShortcut("[ ] ")).toEqual({ remove: 4, block: "check" });
    expect(markdownShortcut("[] ")).toEqual({ remove: 3, block: "check" });
    expect(markdownShortcut("[x] ")).toEqual({ remove: 4, block: "check", checked: true });
    expect(markdownShortcut("[X] ")).toEqual({ remove: 4, block: "check", checked: true });
  });

  it("fires only when the line is exactly the marker", () => {
    expect(markdownShortcut("a string ")).toBeNull();
    expect(markdownShortcut("text - ")).toBeNull();
    expect(markdownShortcut(" - ")).toBeNull();
    expect(markdownShortcut("### ")).toBeNull();
    expect(markdownShortcut("-")).toBeNull();
    // A pasted non-breaking space is still a space.
    expect(markdownShortcut("#\u00a0")).toEqual({ remove: 2, block: "h1" });
  });

  it("does nothing when the setting is off", () => {
    expect(markdownShortcut("# ", { enabled: false })).toBeNull();
  });
});

describe("lineKeyAction (ADR-252 §5.3)", () => {
  const list = { richBlocks: true, block: "bullet" as const, indent: 0 as const };

  it("maps the block shortcuts, on the physical digit so Shift+7 works", () => {
    expect(lineKeyAction({ key: "&", code: "Digit7", meta: true, shift: true })).toEqual({
      type: "toggleBlock",
      block: "ordered",
    });
    expect(lineKeyAction({ key: "*", code: "Digit8", meta: true, shift: true })).toEqual({
      type: "toggleBlock",
      block: "bullet",
    });
    expect(lineKeyAction({ key: "(", code: "Digit9", meta: true, shift: true })).toEqual({
      type: "toggleBlock",
      block: "check",
    });
    expect(lineKeyAction({ key: "¡", code: "Digit1", meta: true, alt: true })).toEqual({
      type: "toggleBlock",
      block: "h1",
    });
    expect(lineKeyAction({ key: "¡", code: "Digit2", meta: true, alt: true })).toEqual({
      type: "toggleBlock",
      block: "h2",
    });
    expect(lineKeyAction({ key: "0", code: "Digit0", meta: true, alt: true })).toEqual({
      type: "setBlock",
      block: null,
    });
  });

  it("keeps the marks of stage 1 and gives ⌘⇧X to strike", () => {
    expect(lineKeyAction({ key: "x", meta: true, shift: true })).toEqual({
      type: "mark",
      mark: "strike",
    });
    expect(lineKeyAction({ key: "b", meta: true })).toEqual({ type: "mark", mark: "bold" });
    expect(lineKeyAction({ key: "i", meta: true })).toEqual({ type: "mark", mark: "italic" });
    expect(lineKeyAction({ key: "u", meta: true })).toEqual({ type: "mark", mark: "underline" });
    expect(lineKeyAction({ key: "e", meta: true })).toEqual({ type: "code" });
    expect(lineKeyAction({ key: "k", meta: true })).toEqual({ type: "link" });
    expect(lineKeyAction({ key: "\\", code: "Backslash", meta: true })).toEqual({
      type: "clearFormatting",
    });
    expect(lineKeyAction({ key: "v", meta: true, shift: true })).toEqual({ type: "plainPaste" });
    expect(lineKeyAction({ key: "Escape" })).toEqual({ type: "close" });
  });

  it("indents a list and starts one from an ordinary line", () => {
    expect(lineKeyAction({ key: "Tab", ...list })).toEqual({ type: "indent", indent: 1 });
    expect(lineKeyAction({ key: "Tab", richBlocks: true, block: "ordered", indent: 2 })).toEqual({
      type: "indent",
      indent: 2,
    });
    expect(lineKeyAction({ key: "Tab", shift: true, ...list, indent: 2 })).toEqual({
      type: "indent",
      indent: 1,
    });
    expect(lineKeyAction({ key: "Tab", shift: true, ...list })).toEqual({
      type: "indent",
      indent: 0,
    });
    expect(lineKeyAction({ key: "Tab", richBlocks: true })).toEqual({ type: "newBullet" });
    expect(lineKeyAction({ key: "Tab", richBlocks: true, block: "h2" })).toEqual({ type: "stay" });
    expect(lineKeyAction({ key: "Tab", shift: true, richBlocks: true })).toEqual({
      type: "chain",
      direction: "left",
    });
  });

  it("keeps ADR-028's chain where blocks do not exist", () => {
    expect(lineKeyAction({ key: "Tab", richBlocks: false })).toEqual({
      type: "chain",
      direction: "right",
    });
    expect(lineKeyAction({ key: "Tab", shift: true, richBlocks: false })).toEqual({
      type: "chain",
      direction: "left",
    });
    expect(lineKeyAction({ key: "Enter", alt: true, richBlocks: false })).toEqual({
      type: "chain",
      direction: "down",
    });
  });

  it("starts a new item of the same kind, and leaves an empty one", () => {
    expect(lineKeyAction({ key: "Enter", ...list, empty: false })).toEqual({
      type: "enter",
      exitList: false,
    });
    expect(lineKeyAction({ key: "Enter", ...list, empty: true })).toEqual({
      type: "enter",
      exitList: true,
    });
    expect(lineKeyAction({ key: "Enter", richBlocks: true, block: "h1", empty: false })).toEqual({
      type: "enter",
      exitList: false,
    });
    expect(lineKeyAction({ key: "Enter", richBlocks: false })).toEqual({ type: "none" });
  });

  it("unwraps a line from the start: level, then format, then the join", () => {
    expect(
      lineKeyAction({ key: "Backspace", atStart: true, ...list, indent: 2 }),
    ).toEqual({ type: "indent", indent: 1 });
    expect(lineKeyAction({ key: "Backspace", atStart: true, ...list })).toEqual({
      type: "clearLine",
    });
    expect(
      lineKeyAction({ key: "Backspace", atStart: true, richBlocks: true, hasPrevious: true }),
    ).toEqual({ type: "mergeUp" });
    expect(lineKeyAction({ key: "Backspace", atStart: true, richBlocks: true })).toEqual({
      type: "none",
    });
    expect(
      lineKeyAction({ key: "Backspace", atStart: true, richBlocks: true, rulePending: true }),
    ).toEqual({ type: "cancelRule" });
  });
});

describe("lineFormatFor", () => {
  it("sets the format, keeps a list's level and toggles the one already set", () => {
    expect(lineFormatFor("ordered", { block: "bullet", indent: 2 })).toEqual({
      block: "ordered",
      indent: 2,
    });
    expect(lineFormatFor("h1", { block: "bullet", indent: 2 })).toEqual({ block: "h1" });
    expect(lineFormatFor("ordered", { block: "ordered" })).toBeNull();
    expect(lineFormatFor("h2", {})).toEqual({ block: "h2" });
    expect(lineFormatFor(null, { block: "h1" })).toBeNull();
  });
});

describe("pasteDelta", () => {
  it("prefers HTML over the plain text beside it, so structure survives", () => {
    const delta = pasteDelta({
      html: "<ul><li>one</li><li>two</li></ul>",
      text: "one\ntwo\n\n- **not markdown**",
    });
    // A formatted last line ends with the newline that carries its format (§2.2).
    expect(deltaText(delta)).toBe("one\ntwo\n");
  });

  it("does not parse Markdown when the clipboard carried HTML", () => {
    const delta = pasteDelta({ html: "<p>**bold**</p>", text: "**bold**" });
    expect(delta).toEqual([{ insert: "**bold**" }]);
  });

  it("parses Markdown from plain text when there is no HTML", () => {
    expect(pasteDelta({ html: null, text: "**bold**" })).toEqual([
      { insert: "bold", attributes: { bold: true } },
    ]);
  });

  it("treats plain text without Markdown as plain text", () => {
    expect(pasteDelta({ html: null, text: "two * three" })).toEqual([
      { insert: "two * three" },
    ]);
  });

  it("takes the text only with ⌘⇧V, Markdown included verbatim", () => {
    expect(pasteDelta({ html: "<b>bold</b>", text: "**bold**", plain: true })).toEqual([
      { insert: "**bold**" },
    ]);
  });

  it("normalises the line endings of clipboard text", () => {
    expect(textOf(pasteDelta({ html: null, text: "a\r\nb", plain: true }))).toBe("a\nb");
  });

  it("falls back to the text when the HTML is only pictures or scripts", () => {
    expect(pasteDelta({ html: "<img src='x.png'>", text: "caption" })).toEqual([
      { insert: "caption" },
    ]);
  });

  it("returns nothing for an empty clipboard", () => {
    expect(pasteDelta({ html: "", text: "" })).toEqual([]);
    expect(pasteDelta({ html: null, text: null })).toEqual([]);
  });
});
