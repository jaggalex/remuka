import { describe, expect, it } from "vitest";
import type { TextLine } from "@remo/model";
import { commonBlock, linksOf, normalizeHref } from "./textFormatBar";

/**
 * The format bar's pure decisions (ADR-252 §6, §9).
 *
 * The DOM reader only chooses which lines to ask about; what counts as "the current
 * format" and what an address may be are functions, tested here without a browser.
 */

describe("commonBlock — the format the bar marks as pressed", () => {
  it("is the block every touched line shares", () => {
    // A caret on one bullet, then a selection over two of them.
    expect(commonBlock([{ block: "bullet" }])).toBe("bullet");
    expect(commonBlock([{ block: "ordered" }, { block: "ordered" }])).toBe("ordered");
  });

  it("is nothing for a plain line or a mixed selection", () => {
    expect(commonBlock(undefined)).toBeNull();
    expect(commonBlock([])).toBeNull();
    expect(commonBlock([{}])).toBeNull();
    expect(commonBlock([{ block: null }])).toBeNull();
    expect(commonBlock([{ block: "h1" }, {}])).toBeNull();
    expect(commonBlock([{ block: "bullet" }, { block: "ordered" }])).toBeNull();
  });
});

describe("linksOf", () => {
  const line = (runs: Array<{ text: string; href?: string }>): TextLine => ({
    runs,
    indent: 0,
    checked: false,
  });

  it("lists every distinct address in reading order", () => {
    expect(
      linksOf([
        line([{ text: "a " }, { text: "one", href: "https://example.com/" }]),
        line([{ text: "two", href: "https://example.com/" }, { text: " " }, { text: "b", href: "mailto:a@b.co" }]),
      ]),
    ).toEqual(["https://example.com/", "mailto:a@b.co"]);
  });

  it("is empty for plain text", () => {
    expect(linksOf(undefined)).toEqual([]);
    expect(linksOf([line([{ text: "plain" }])])).toEqual([]);
  });
});

describe("normalizeHref — what the link window accepts", () => {
  it("keeps a valid address, with its scheme", () => {
    expect(normalizeHref("https://example.com/a?b=c")).toEqual({
      href: "https://example.com/a?b=c",
    });
    expect(normalizeHref("  http://example.com  ")).toEqual({ href: "http://example.com/" });
    expect(normalizeHref("mailto:team@example.com")).toEqual({
      href: "mailto:team@example.com",
    });
  });

  it("gives a bare domain https and a bare e-mail mailto", () => {
    expect(normalizeHref("example.com")).toEqual({ href: "https://example.com/" });
    expect(normalizeHref("team@example.com")).toEqual({ href: "mailto:team@example.com" });
  });

  it("refuses what the model refuses", () => {
    expect(normalizeHref("")).toEqual({ error: "empty" });
    expect(normalizeHref("   ")).toEqual({ error: "empty" });
    expect(normalizeHref("javascript:alert(1)")).toEqual({ error: "scheme" });
    expect(normalizeHref("data:text/html,hi")).toEqual({ error: "scheme" });
    expect(normalizeHref("ftp://example.com")).toEqual({ error: "scheme" });
    expect(normalizeHref("https://")).toEqual({ error: "address" });
    expect(normalizeHref("not a url")).toEqual({ error: "scheme" });
  });
});
