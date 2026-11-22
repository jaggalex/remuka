import { describe, expect, it } from "vitest";
import {
  cleanMarkdown,
  displayTextOf,
  linesOf,
  normalizeDelta,
  parseMarkdown,
  safeExternalUrl,
  toMarkdown,
} from "./index.mjs";

/**
 * The package boundary (ADR-253): the sync service and the browser load this module
 * through the same import, so the round trip and the line reader must hold here rather
 * than only in `@remo/doc`. The full dialect contract lives in
 * `packages/doc/src/markdown.test.ts`; these are the facts the server relies on.
 */

describe("@remo/text", () => {
  it("round-trips a formatted delta through Markdown", () => {
    const delta = [
      { insert: "Sprint" },
      { insert: "\n", attributes: { block: "h1" } },
      { insert: "one" },
      { insert: "\n", attributes: { block: "check", checked: true } },
      { insert: "two", attributes: { bold: true } },
    ];
    expect(toMarkdown(delta)).toBe("# Sprint\n- [x] one\n**two**");
    expect(normalizeDelta(parseMarkdown(toMarkdown(delta)))).toEqual(normalizeDelta(delta));
  });

  it("reads lines with computed numbering, not a stored one", () => {
    const lines = linesOf(parseMarkdown("1. one\n2. two\n  1. nested"));
    expect(lines.map((line) => line.ordinal)).toEqual([1, 2, 1]);
    expect(lines.map((line) => line.indent)).toEqual([0, 0, 1]);
  });

  it("keeps the plain mirror without the terminator of a formatted last line", () => {
    const delta = parseMarkdown("- one\n- two");
    expect(displayTextOf(delta)).toBe("one\ntwo");
    expect(delta.map((op) => op.insert).join("")).toBe("one\ntwo\n");
  });

  it("accepts only http, https and mailto links", () => {
    expect(safeExternalUrl("https://example.test/a")).toBe("https://example.test/a");
    expect(safeExternalUrl("mailto:a@example.test")).toBe("mailto:a@example.test");
    expect(safeExternalUrl("javascript:alert(1)")).toBeNull();
    expect(safeExternalUrl("data:text/html,x")).toBeNull();
  });

  it("leaves no markup for the writing boundary", () => {
    expect(cleanMarkdown("<script>alert(1)</script>**hi**")).toBe("**hi**");
    expect(parseMarkdown(cleanMarkdown("<b>hi</b>"))).toEqual([
      { insert: "hi", attributes: { bold: true } },
    ]);
  });
});
