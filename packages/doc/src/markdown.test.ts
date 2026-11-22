import { describe, expect, it } from "vitest";
import type { LineFormat, TextDeltaOp, TextMarks } from "@remo/model";
import { cleanMarkdown, isMarkdown, parseMarkdown, toMarkdown } from "./markdown";
import { normalizeDelta } from "./text";
import github from "./__fixtures__/paste/github.md?raw";

const textOf = (delta: TextDeltaOp[]): string => delta.map((op) => op.insert).join("");

describe("parseMarkdown", () => {
  it("reads bold with both markers", () => {
    expect(parseMarkdown("**strong**")).toEqual([{ insert: "strong", attributes: { bold: true } }]);
    expect(parseMarkdown("__strong__")).toEqual([{ insert: "strong", attributes: { bold: true } }]);
  });

  it("reads italic with both markers and keeps snake_case alone", () => {
    expect(parseMarkdown("*soft*")).toEqual([{ insert: "soft", attributes: { italic: true } }]);
    expect(parseMarkdown("_soft_")).toEqual([{ insert: "soft", attributes: { italic: true } }]);
    expect(parseMarkdown("snake_case_name")).toEqual([{ insert: "snake_case_name" }]);
  });

  it("reads strikethrough", () => {
    expect(parseMarkdown("~~gone~~")).toEqual([{ insert: "gone", attributes: { strike: true } }]);
  });

  it("reads inline code as a code mark", () => {
    expect(parseMarkdown("use `**not bold**` here")).toEqual([
      { insert: "use " },
      { insert: "**not bold**", attributes: { code: true } },
      { insert: " here" },
    ]);
    expect(parseMarkdown("`snake_case`")).toEqual([
      { insert: "snake_case", attributes: { code: true } },
    ]);
    // A literal backtick inside a span needs a longer delimiter.
    expect(parseMarkdown("``a ` b``")).toEqual([
      { insert: "a ` b", attributes: { code: true } },
    ]);
  });

  it("reads a fenced block as code lines and drops the fences", () => {
    const delta = parseMarkdown("before\n```\n**not bold**\n_also not italic_\n```\nafter");
    expect(textOf(delta)).toBe("before\n**not bold**\n_also not italic_\nafter");
    expect(delta.filter((op) => op.attributes?.code)).toEqual([
      { insert: "**not bold**", attributes: { code: true } },
      { insert: "_also not italic_", attributes: { code: true } },
    ]);
  });

  it("reads underline from the one inline tag Markdown has no syntax for", () => {
    expect(parseMarkdown("<u>under</u>")).toEqual([
      { insert: "under", attributes: { underline: true } },
    ]);
  });

  it("keeps a link's target when the scheme is safe", () => {
    expect(parseMarkdown("[docs](https://example.test/a)")).toEqual([
      { insert: "docs", attributes: { href: "https://example.test/a" } },
    ]);
    expect(parseMarkdown("[mail](mailto:a@example.test)")).toEqual([
      { insert: "mail", attributes: { href: "mailto:a@example.test" } },
    ]);
    // An unsafe scheme is not a link; the label survives and the address is dropped.
    expect(parseMarkdown("[bad](javascript:alert(1))")).toEqual([{ insert: "bad" }]);
    expect(parseMarkdown("[bad](data:text/html,x)")).toEqual([{ insert: "bad" }]);
  });

  it("reads marks inside a link label", () => {
    expect(parseMarkdown("[**docs**](https://example.test/a)")).toEqual([
      { insert: "docs", attributes: { bold: true, href: "https://example.test/a" } },
    ]);
  });

  it("turns an escape into the character it protects", () => {
    expect(parseMarkdown("\\*not italic\\*")).toEqual([{ insert: "*not italic*" }]);
    expect(parseMarkdown("\\_x\\_")).toEqual([{ insert: "_x_" }]);
    expect(parseMarkdown("a \\\\ b")).toEqual([{ insert: "a \\ b" }]);
    expect(parseMarkdown("\\<u>x\\</u>")).toEqual([{ insert: "<u>x</u>" }]);
    // A backslash before a letter is just a backslash.
    expect(parseMarkdown("C:\\Temp")).toEqual([{ insert: "C:\\Temp" }]);
  });

  it("nests bold and italic", () => {
    expect(parseMarkdown("**bold *both* bold**")).toEqual([
      { insert: "bold ", attributes: { bold: true } },
      { insert: "both", attributes: { bold: true, italic: true } },
      { insert: " bold", attributes: { bold: true } },
    ]);
    expect(parseMarkdown("***both***")).toEqual([
      { insert: "both", attributes: { bold: true, italic: true } },
    ]);
  });

  it("does not read arithmetic as emphasis", () => {
    expect(parseMarkdown("2 * 3 * 4")).toEqual([{ insert: "2 * 3 * 4" }]);
  });

  it("leaves an unclosed marker as text", () => {
    expect(parseMarkdown("**half")).toEqual([{ insert: "**half" }]);
    expect(parseMarkdown("*half")).toEqual([{ insert: "*half" }]);
    expect(parseMarkdown("~~half")).toEqual([{ insert: "~~half" }]);
  });

  it("reads headings, lists and checklists as line formats", () => {
    expect(parseMarkdown("# One\n### Three")).toEqual([
      { insert: "One" },
      { insert: "\n", attributes: { block: "h1" } },
      { insert: "Three" },
      { insert: "\n", attributes: { block: "h2" } },
    ]);
    expect(parseMarkdown("- one\n  - two\n    - three")).toEqual([
      { insert: "one" },
      { insert: "\n", attributes: { block: "bullet" } },
      { insert: "two" },
      { insert: "\n", attributes: { block: "bullet", indent: 1 } },
      { insert: "three" },
      { insert: "\n", attributes: { block: "bullet", indent: 2 } },
    ]);
    expect(parseMarkdown("1. one\n2) two")).toEqual([
      { insert: "one" },
      { insert: "\n", attributes: { block: "ordered" } },
      { insert: "two" },
      { insert: "\n", attributes: { block: "ordered" } },
    ]);
    expect(parseMarkdown("- [ ] todo\n- [x] done")).toEqual([
      { insert: "todo" },
      { insert: "\n", attributes: { block: "check" } },
      { insert: "done" },
      { insert: "\n", attributes: { block: "check", checked: true } },
    ]);
  });

  it("strips a quote marker and keeps the line", () => {
    expect(parseMarkdown("> quoted")).toEqual([{ insert: "quoted" }]);
    expect(parseMarkdown("> a\n> b")).toEqual([{ insert: "a\nb" }]);
  });

  it("keeps lines one for one", () => {
    expect(parseMarkdown("**a**\nb")).toEqual([
      { insert: "a", attributes: { bold: true } },
      { insert: "\nb" },
    ]);
  });

  it("handles empty and plain input", () => {
    expect(parseMarkdown("")).toEqual([]);
    expect(parseMarkdown("just text")).toEqual([{ insert: "just text" }]);
    expect(parseMarkdown("a\n")).toEqual([{ insert: "a\n" }]);
  });

  it("reads the GitHub fixture", () => {
    const delta = parseMarkdown(github);
    expect(textOf(delta)).toBe(
      "Release\n\ntag\nnotes\n\nbold and soft, old, code, docs.\n\nfirst\nsecond\nnested\n",
    );
    // Blank lines merge into the text beside them, so only real line formats remain.
    expect(delta.filter((op) => op.insert === "\n")).toEqual([
      { insert: "\n", attributes: { block: "h1" } },
      { insert: "\n", attributes: { block: "check", checked: true } },
      { insert: "\n", attributes: { block: "check" } },
      { insert: "\n" },
      { insert: "\n", attributes: { block: "ordered" } },
      { insert: "\n", attributes: { block: "ordered" } },
      { insert: "\n", attributes: { block: "bullet", indent: 1 } },
    ]);
    expect(delta.find((op) => op.insert === "bold")?.attributes).toEqual({ bold: true });
    expect(delta.find((op) => op.insert === "soft")?.attributes).toEqual({ italic: true });
    expect(delta.find((op) => op.insert === "old")?.attributes).toEqual({ strike: true });
    expect(delta.find((op) => op.insert === "code")?.attributes).toEqual({ code: true });
    expect(delta.find((op) => op.insert === "docs")?.attributes).toEqual({
      href: "https://example.test/a",
    });
  });
});

const URLS = [
  "https://example.test/a",
  "https://example.test/a/b?c=d",
  "mailto:a@example.test",
];

const CHARACTERS = "abz  *_~`[]()\\< >#-+1.|!".split("");

/** Deterministic PRNG, so a failure is reproducible from its seed. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function randomText(next: () => number): string {
  const length = 1 + Math.floor(next() * 6);
  let text = "";
  for (let index = 0; index < length; index += 1) {
    text += CHARACTERS[Math.floor(next() * CHARACTERS.length)]!;
  }
  return text;
}

const BLOCKS: Array<LineFormat["block"] | undefined> = [
  undefined,
  "h1",
  "h2",
  "bullet",
  "ordered",
  "check",
];

function randomDelta(seed: number): TextDeltaOp[] {
  const next = random(seed);
  const count = 1 + Math.floor(next() * 4);
  const ops: TextDeltaOp[] = [];
  for (let line = 0; line < count; line += 1) {
    const block = BLOCKS[Math.floor(next() * BLOCKS.length)];
    const list = block === "bullet" || block === "ordered" || block === "check";
    const indent = list ? ((Math.floor(next() * 3) as 0 | 1 | 2) || 0) : 0;
    const checked = block === "check" && next() < 0.5;
    const runs = Math.floor(next() * 3);
    for (let run = 0; run < runs; run += 1) {
      const marks: TextMarks = {};
      if (next() < 0.3) marks.bold = true;
      if (next() < 0.3) marks.italic = true;
      if (next() < 0.3) marks.underline = true;
      if (next() < 0.3) marks.strike = true;
      if (next() < 0.3) marks.code = true;
      if (next() < 0.2) marks.href = URLS[Math.floor(next() * URLS.length)];
      ops.push({
        insert: randomText(next),
        ...(Object.keys(marks).length ? { attributes: marks } : {}),
      });
    }
    const format: LineFormat = {};
    if (block) format.block = block;
    if (indent) format.indent = indent;
    if (checked) format.checked = true;
    const last = line === count - 1;
    if (!last || format.block) {
      ops.push({
        insert: "\n",
        ...(Object.keys(format).length ? { attributes: format } : {}),
      });
    }
  }
  return normalizeDelta(ops);
}

describe("toMarkdown", () => {
  it("writes every mark and block in the dialect it reads", () => {
    expect(
      toMarkdown([
        { insert: "bold", attributes: { bold: true } },
        { insert: " " },
        { insert: "both", attributes: { bold: true, italic: true } },
        { insert: " " },
        { insert: "under", attributes: { underline: true } },
        { insert: " " },
        { insert: "gone", attributes: { strike: true } },
        { insert: " " },
        { insert: "code", attributes: { code: true } },
        { insert: " " },
        { insert: "docs", attributes: { href: "https://example.test/a" } },
      ]),
    ).toBe("**bold** ***both*** <u>under</u> ~~gone~~ `code` [docs](https://example.test/a)");
  });

  it("writes headings, lists, levels and checkboxes", () => {
    expect(
      toMarkdown([
        { insert: "Head" },
        { insert: "\n", attributes: { block: "h1" } },
        { insert: "one" },
        { insert: "\n", attributes: { block: "bullet" } },
        { insert: "two" },
        { insert: "\n", attributes: { block: "bullet", indent: 1 } },
        { insert: "done" },
        { insert: "\n", attributes: { block: "check", checked: true } },
        { insert: "next" },
        { insert: "\n", attributes: { block: "check" } },
      ]),
    ).toBe("# Head\n- one\n  - two\n- [x] done\n- [ ] next");
  });

  it("escapes text that would otherwise read as markup", () => {
    expect(toMarkdown([{ insert: "1. not a list" }])).toBe("1\\. not a list");
    expect(toMarkdown([{ insert: "- not a list" }])).toBe("\\- not a list");
    expect(toMarkdown([{ insert: "# not a heading" }])).toBe("\\# not a heading");
    expect(toMarkdown([{ insert: "a * b [c] `d`" }])).toBe("a \\* b \\[c\\] \\`d\\`");
    expect(toMarkdown([{ insert: "snake_case" }])).toBe("snake_case");
  });

  it("writes a code line as a fence and keeps a backtick inside it", () => {
    expect(toMarkdown([{ insert: "a ``` b", attributes: { code: true } }])).toBe(
      "````\na ``` b\n````",
    );
  });
});

describe("round trip delta → markdown → delta", () => {
  it("holds for hand-picked deltas", () => {
    const samples: TextDeltaOp[][] = [
      [{ insert: "plain" }],
      [{ insert: "two\nlines" }],
      [{ insert: "a\n\nb" }],
      [{ insert: "  padded  " }],
      [{ insert: "snake_case and 2 * 3" }],
      [{ insert: "a ` b", attributes: { code: true } }],
      [
        { insert: "x", attributes: { bold: true, code: true } },
        { insert: "y", attributes: { href: "https://example.test/a", italic: true } },
      ],
      [
        { insert: "head" },
        { insert: "\n", attributes: { block: "h1" } },
        { insert: "one" },
        { insert: "\n", attributes: { block: "ordered", indent: 2 } },
        { insert: "" },
      ],
    ];
    for (const sample of samples) {
      expect(normalizeDelta(parseMarkdown(toMarkdown(sample)))).toEqual(normalizeDelta(sample));
    }
  });

  it("holds for 10000 random deltas", () => {
    for (let seed = 1; seed <= 10000; seed += 1) {
      const delta = randomDelta(seed);
      const markdown = toMarkdown(delta);
      const back = normalizeDelta(parseMarkdown(markdown));
      if (JSON.stringify(back) !== JSON.stringify(delta)) {
        throw new Error(`seed ${seed}\n${JSON.stringify(delta)}\n---\n${markdown}\n---\n${JSON.stringify(back)}`);
      }
    }
  });
});

describe("isMarkdown", () => {
  it("recognises the constructs the note can render", () => {
    expect(isMarkdown("**bold**")).toBe(true);
    expect(isMarkdown("__bold__")).toBe(true);
    expect(isMarkdown("~~gone~~")).toBe(true);
    expect(isMarkdown("use `code` here")).toBe(true);
    expect(isMarkdown("[docs](https://example.test)")).toBe(true);
    expect(isMarkdown("- one\n- two")).toBe(true);
    expect(isMarkdown("* one")).toBe(true);
    expect(isMarkdown("1. one")).toBe(true);
    expect(isMarkdown("1) one")).toBe(true);
    expect(isMarkdown("- [ ] task")).toBe(true);
    expect(isMarkdown("- [x] done")).toBe(true);
    expect(isMarkdown("# Heading")).toBe(true);
    expect(isMarkdown("## Heading")).toBe(true);
    expect(isMarkdown("```\ncode\n```")).toBe(true);
  });

  it("does not claim plain prose", () => {
    expect(isMarkdown("")).toBe(false);
    expect(isMarkdown("two * three")).toBe(false);
    expect(isMarkdown("a * b * c")).toBe(false);
    expect(isMarkdown("http://example.test")).toBe(false);
    expect(isMarkdown("[not a link]")).toBe(false);
    expect(isMarkdown("[text](not-an-http-target)")).toBe(false);
    expect(isMarkdown("[text](javascript:alert(1))")).toBe(false);
    expect(isMarkdown('{"kind":"remo/fragment","version":1}')).toBe(false);
  });
});

describe("cleanMarkdown (untrusted authoring, ADR-252 §11 stage 7)", () => {
  it("drops foreign tags but keeps the words", () => {
    expect(cleanMarkdown("a <span>b</span> c")).toBe("a b c");
    expect(cleanMarkdown('<a href="https://example.test">label</a>')).toBe("label");
    expect(cleanMarkdown("a <b class=\"x\">bold</b>")).toBe("a bold");
  });

  it("drops a script with its content and an HTML comment", () => {
    expect(cleanMarkdown("before<script>alert(1)</script>after")).toBe("beforeafter");
    expect(cleanMarkdown("x<!-- hidden -->y")).toBe("xy");
    expect(cleanMarkdown("<style>p{}</style>text")).toBe("text");
  });

  it("keeps the six inline tags the dialect reads as marks", () => {
    expect(cleanMarkdown("<b>bold</b> <u>under</u> <code>x</code>")).toBe(
      "<b>bold</b> <u>under</u> <code>x</code>",
    );
    // And they become marks, not markup, once parsed.
    expect(parseMarkdown(cleanMarkdown("<b>bold</b>"))).toEqual([
      { insert: "bold", attributes: { bold: true } },
    ]);
  });

  it("keeps an autolink, which only looks like a tag", () => {
    expect(cleanMarkdown("<https://example.test>")).toBe("<https://example.test>");
    expect(cleanMarkdown("<mailto:a@example.test>")).toBe("<mailto:a@example.test>");
  });
});
