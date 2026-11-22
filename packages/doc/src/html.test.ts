import { describe, expect, it } from "vitest";
import type { TextDeltaOp } from "@remo/model";
import { deltaFromHtml, htmlFromDelta } from "./html";
import { normalizeDelta } from "./text";
import googleDocs from "./__fixtures__/paste/google-docs.html?raw";
import notion from "./__fixtures__/paste/notion.html?raw";
import word from "./__fixtures__/paste/word.html?raw";
import webPage from "./__fixtures__/paste/web-page.html?raw";
import longLine from "./__fixtures__/paste/long-line.html?raw";

const textOf = (delta: TextDeltaOp[]): string => {
  const text = delta.map((op) => op.insert).join("");
  const last = delta[delta.length - 1];
  // A formatted last line carries a terminating newline that is not an empty line
  // (ADR-252 §2.2), so the visible text does not end with it.
  return last?.insert === "\n" && last.attributes?.block ? text.slice(0, -1) : text;
};
const blocksOf = (delta: TextDeltaOp[]): Array<string | null> =>
  delta
    .filter((op) => op.insert === "\n")
    .map((op) => op.attributes?.block ?? null);

describe("deltaFromHtml", () => {
  it("gives each list item its own line and its format", () => {
    const delta = deltaFromHtml("<ul><li>one</li><li>two</li><li>three</li></ul>");
    expect(textOf(delta)).toBe("one\ntwo\nthree");
    expect(blocksOf(delta)).toEqual(["bullet", "bullet", "bullet"]);

    const ordered = deltaFromHtml("<ol><li>first</li><li>second</li></ol>");
    expect(textOf(ordered)).toBe("first\nsecond");
    expect(blocksOf(ordered)).toEqual(["ordered", "ordered"]);
  });

  it("reads list nesting as the model's two levels of indent", () => {
    const delta = deltaFromHtml(
      "<ul><li>a<ul><li>b<ul><li>c<ul><li>d</li></ul></li></ul></li></ul></li></ul>",
    );
    expect(textOf(delta)).toBe("a\nb\nc\nd");
    const indents = delta
      .filter((op) => op.insert === "\n")
      .map((op) => op.attributes?.indent ?? 0);
    expect(indents).toEqual([0, 1, 2, 2]);
  });

  it("gives headings and paragraphs their own lines", () => {
    const delta = deltaFromHtml("<h1>Title</h1><h2>Sub</h2><h3>Three</h3><p>Body</p>");
    expect(textOf(delta)).toBe("Title\nSub\nThree\nBody");
    expect(blocksOf(delta)).toEqual(["h1", "h2", "h2"]);
    expect(textOf(deltaFromHtml("<div>one</div><div>two</div>"))).toBe("one\ntwo");
    expect(textOf(deltaFromHtml("<p>one<br>two</p>"))).toBe("one\ntwo");
  });

  it("keeps an intentional empty line and drops the boundary ones", () => {
    expect(textOf(deltaFromHtml("<p>one</p><p></p><p>two</p>"))).toBe("one\n\ntwo");
    expect(textOf(deltaFromHtml("<p>one<br><br>two</p>"))).toBe("one\n\ntwo");
    expect(textOf(deltaFromHtml("<p></p><p>one</p><p></p>"))).toBe("one");
    // A `<br>` alone keeps the empty line open; it is not a second line.
    expect(textOf(deltaFromHtml("<p><br></p><p>one</p>"))).toBe("one");
  });

  it("reads tags as marks", () => {
    expect(deltaFromHtml("<p><b>bold</b> <i>italic</i> <u>under</u> <s>gone</s></p>")).toEqual([
      { insert: "bold", attributes: { bold: true } },
      { insert: " " },
      { insert: "italic", attributes: { italic: true } },
      { insert: " " },
      { insert: "under", attributes: { underline: true } },
      { insert: " " },
      { insert: "gone", attributes: { strike: true } },
    ]);
    expect(deltaFromHtml("<p><strike>a</strike><del>b</del></p>")).toEqual([
      { insert: "ab", attributes: { strike: true } },
    ]);
    expect(deltaFromHtml("<p><code>a</code><kbd>b</kbd><samp>c</samp></p>")).toEqual([
      { insert: "abc", attributes: { code: true } },
    ]);
  });

  it("reads CSS weight and slants, but not the Google Docs wrapper", () => {
    expect(deltaFromHtml('<p><span style="font-weight:700">bold</span></p>')).toEqual([
      { insert: "bold", attributes: { bold: true } },
    ]);
    expect(deltaFromHtml('<p><span style="font-weight:600">six</span></p>')).toEqual([
      { insert: "six", attributes: { bold: true } },
    ]);
    expect(
      deltaFromHtml('<p><span style="font-style:italic;text-decoration:underline">both</span></p>'),
    ).toEqual([{ insert: "both", attributes: { italic: true, underline: true } }]);
    expect(
      deltaFromHtml('<p><span style="text-decoration:line-through">gone</span></p>'),
    ).toEqual([{ insert: "gone", attributes: { strike: true } }]);
    expect(
      deltaFromHtml('<p><span style="font-family:Courier New, monospace">code</span></p>'),
    ).toEqual([{ insert: "code", attributes: { code: true } }]);
    // The wrapper is typography; the bold inside it is content.
    expect(
      deltaFromHtml(
        '<b style="font-weight:normal;" id="docs-internal-guid-1"><span style="font-weight:700">real</span></b>',
      ),
    ).toEqual([{ insert: "real", attributes: { bold: true } }]);
    expect(deltaFromHtml('<strong style="font-weight: 400">plain</strong>')).toEqual([
      { insert: "plain" },
    ]);
  });

  it("keeps a link's text and its safe target, and forgets an unsafe one", () => {
    expect(deltaFromHtml('<p><a href="https://example.test/x">link</a></p>')).toEqual([
      { insert: "link", attributes: { href: "https://example.test/x" } },
    ]);
    expect(deltaFromHtml('<p><a href="mailto:a@example.test">mail</a></p>')).toEqual([
      { insert: "mail", attributes: { href: "mailto:a@example.test" } },
    ]);
    expect(deltaFromHtml('<p><a href="javascript:alert(1)">bad</a></p>')).toEqual([
      { insert: "bad" },
    ]);
    expect(deltaFromHtml('<p><a href="data:text/html,x">bad</a></p>')).toEqual([
      { insert: "bad" },
    ]);
    // A link is drawn underlined already, so the mark is not doubled.
    expect(
      deltaFromHtml('<p><a href="https://example.test"><u>link</u></a></p>'),
    ).toEqual([{ insert: "link", attributes: { href: "https://example.test/" } }]);
  });

  it("reads a checklist from GitHub, Notion and our own clipboard", () => {
    expect(
      deltaFromHtml(
        '<ul><li class="task-list-item"><input type="checkbox" checked disabled> done</li><li class="task-list-item"><input type="checkbox" disabled> next</li></ul>',
      ),
    ).toEqual([
      { insert: "done" },
      { insert: "\n", attributes: { block: "check", checked: true } },
      { insert: "next" },
      { insert: "\n", attributes: { block: "check" } },
    ]);
    expect(
      deltaFromHtml(
        '<ul data-check="true"><li data-checked="true"><input type="checkbox" checked disabled>ok</li></ul>',
      ),
    ).toEqual([
      { insert: "ok" },
      { insert: "\n", attributes: { block: "check", checked: true } },
    ]);
  });

  it("drops scripts, styles, pictures and comments with their contents", () => {
    expect(
      deltaFromHtml("<style>p{color:red}</style><script>alert('x')</script><p>ok</p>"),
    ).toEqual([{ insert: "ok" }]);
    expect(deltaFromHtml("<p>a<script>alert(1)</script>b</p>")).toEqual([{ insert: "ab" }]);
    expect(deltaFromHtml('<p>a</p><img src="x" onerror="alert(1)"><p>b</p>')).toEqual([
      { insert: "a\nb" },
    ]);
    expect(deltaFromHtml("<!-- note --><p>a</p>")).toEqual([{ insert: "a" }]);
  });

  it("keeps a monospace pre block with every space and line", () => {
    const delta = deltaFromHtml("<pre><code>let a = 1;\n  return a;</code></pre>");
    expect(textOf(delta)).toBe("let a = 1;\n  return a;");
    expect(delta.every((op) => op.insert === "\n" || op.attributes?.code === true)).toBe(true);
  });

  it("joins table cells with a middle dot and rows with a line", () => {
    expect(textOf(deltaFromHtml("<table><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table>"))).toBe(
      "a \u00b7 b\nc \u00b7 d",
    );
    expect(textOf(deltaFromHtml("<table><tr><th>Name</th><th>Score</th></tr></table>"))).toBe(
      "Name \u00b7 Score",
    );
  });

  it("nests marks the way the delta does", () => {
    expect(deltaFromHtml("<p><b>a<i>b</i></b></p>")).toEqual([
      { insert: "a", attributes: { bold: true } },
      { insert: "b", attributes: { bold: true, italic: true } },
    ]);
  });

  it("decodes entities and keeps a non-breaking space", () => {
    expect(deltaFromHtml("<p>a &amp; b &lt;c&gt;</p>")).toEqual([{ insert: "a & b <c>" }]);
    expect(deltaFromHtml("<p>a&nbsp;b</p>")).toEqual([{ insert: "a\u00a0b" }]);
  });

  it("collapses page whitespace between blocks", () => {
    const pretty = `
      <ul>
        <li>one</li>
        <li>two</li>
      </ul>
    `;
    expect(textOf(deltaFromHtml(pretty))).toBe("one\ntwo");
  });

  it("returns an empty delta for a fragment with no text", () => {
    expect(deltaFromHtml("")).toEqual([]);
    expect(deltaFromHtml("<img src=x>")).toEqual([]);
    expect(deltaFromHtml("<p>&nbsp;</p>")).toEqual([{ insert: "\u00a0" }]);
  });
});

describe("fixtures from other products", () => {
  it("Google Docs: no false bold wrapper, the 700 span is real bold", () => {
    expect(deltaFromHtml(googleDocs)).toEqual([
      { insert: "Hello " },
      { insert: "world", attributes: { bold: true } },
      { insert: "\n" },
      { insert: "soft", attributes: { italic: true } },
      { insert: " " },
      { insert: "line", attributes: { underline: true } },
    ]);
  });

  it("Notion: heading, checklist and nested bullets", () => {
    expect(textOf(deltaFromHtml(notion))).toBe("Plan\nDone\nNext\nFirst\nSecond\nNested");
    expect(deltaFromHtml(notion)).toEqual([
      { insert: "Plan" },
      { insert: "\n", attributes: { block: "h1" } },
      { insert: "Done" },
      { insert: "\n", attributes: { block: "check", checked: true } },
      { insert: "Next" },
      { insert: "\n", attributes: { block: "check" } },
      { insert: "First" },
      { insert: "\n", attributes: { block: "bullet" } },
      { insert: "Second" },
      { insert: "\n", attributes: { block: "bullet" } },
      { insert: "Nested" },
      { insert: "\n", attributes: { block: "bullet", indent: 1 } },
    ]);
  });

  it("Word: an all-bold paragraph bigger than the body becomes a heading", () => {
    expect(textOf(deltaFromHtml(word))).toBe(
      "Quarterly review\nThe numbers were better than planned.\nDraft",
    );
    expect(blocksOf(deltaFromHtml(word))).toEqual(["h2"]);
  });

  it("a web page: span styles, safe links, a table and a very long line", () => {
    const delta = deltaFromHtml(webPage);
    expect(textOf(delta)).toBe(
      "Lead with both.\ngood bad data\nName \u00b7 Score\nAnn \u00b7 9\nQuoted words.",
    );
    expect(delta[0]).toEqual({ insert: "Lead", attributes: { bold: true } });
    const good = delta.find((op) => op.insert === "good");
    expect(good?.attributes?.href).toBe("https://example.test/page");
    expect(delta.find((op) => op.insert === "bad")?.attributes).toBeUndefined();

    const long = deltaFromHtml(longLine);
    expect(textOf(long).length).toBe(5000 + 10 + 1 + 3);
    expect(textOf(long).endsWith("\nend")).toBe(true);
  });
});

describe("htmlFromDelta", () => {
  it("writes the editor's line divs and the marks it reads back", () => {
    expect(
      htmlFromDelta([
        { insert: "a", attributes: { bold: true } },
        { insert: "b", attributes: { italic: true } },
        { insert: "c", attributes: { underline: true } },
        { insert: "d", attributes: { strike: true } },
        { insert: "e", attributes: { code: true } },
        { insert: "f", attributes: { href: "https://example.com/" } },
      ]),
    ).toBe(
      '<div><b>a</b><i>b</i><u>c</u><s>d</s><code>e</code>' +
        '<a href="https://example.com/" rel="noopener noreferrer">f</a></div>',
    );
  });

  it("writes every line as its own div and escapes markup", () => {
    expect(htmlFromDelta([{ insert: "a\n<b>" }])).toBe("<div>a</div><div>&lt;b&gt;</div>");
    expect(htmlFromDelta([])).toBe("<div><br></div>");
  });

  it("carries the block format, the level and the computed number", () => {
    expect(
      htmlFromDelta([
        { insert: "head" },
        { insert: "\n", attributes: { block: "h1" } },
        { insert: "one" },
        { insert: "\n", attributes: { block: "ordered", indent: 1 } },
        { insert: "done" },
        { insert: "\n", attributes: { block: "check", checked: true } },
      ]),
    ).toBe(
      '<div data-block="h1">head</div>' +
        '<div data-block="ordered" data-indent="1" data-ordinal="1">one</div>' +
        '<div data-block="check" data-checked="true">done</div>',
    );
  });

  it("writes the clipboard flavour with semantic tags", () => {
    expect(
      htmlFromDelta(
        [
          { insert: "Head" },
          { insert: "\n", attributes: { block: "h1" } },
          { insert: "one" },
          { insert: "\n", attributes: { block: "bullet" } },
          { insert: "two" },
          { insert: "\n", attributes: { block: "bullet", indent: 1 } },
          { insert: "done" },
          { insert: "\n", attributes: { block: "check", checked: true } },
          { insert: "Body" },
        ],
        { clipboard: true },
      ),
    ).toBe(
      "<h1>Head</h1>" +
        "<ul><li>one</li><li data-indent=\"1\">two</li></ul>" +
        '<ul data-check="true"><li data-checked="true"><input type="checkbox" checked disabled>done</li></ul>' +
        "<p>Body</p>",
    );
  });

  it("escapes a quote in a link and a tag in the text", () => {
    expect(
      htmlFromDelta([
        { insert: "<i>", attributes: { href: "https://example.test/a?b=%22c%22" } },
      ]),
    ).toBe(
      '<div><a href="https://example.test/a?b=%22c%22" rel="noopener noreferrer">&lt;i&gt;</a></div>',
    );
  });
});

describe("round trip delta → html → delta", () => {
  const samples: TextDeltaOp[][] = [
    [{ insert: "plain" }],
    [{ insert: "two\nlines" }],
    [{ insert: "a\n\nb" }],
    [
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
      { insert: "link", attributes: { href: "https://example.test/a" } },
    ],
    [
      { insert: "head" },
      { insert: "\n", attributes: { block: "h1" } },
      { insert: "sub" },
      { insert: "\n", attributes: { block: "h2" } },
      { insert: "one" },
      { insert: "\n", attributes: { block: "bullet" } },
      { insert: "two" },
      { insert: "\n", attributes: { block: "ordered", indent: 1 } },
      { insert: "done" },
      { insert: "\n", attributes: { block: "check", checked: true } },
      { insert: "next" },
      { insert: "\n", attributes: { block: "check" } },
    ],
    [{ insert: "x < y & z", attributes: { href: "mailto:a@example.test" } }],
  ];

  it("keeps the editor flavour", () => {
    for (const sample of samples) {
      expect(deltaFromHtml(htmlFromDelta(sample))).toEqual(normalizeDelta(sample));
    }
  });

  it("keeps the clipboard flavour", () => {
    for (const sample of samples) {
      expect(deltaFromHtml(htmlFromDelta(sample, { clipboard: true }))).toEqual(
        normalizeDelta(sample),
      );
    }
  });
});
