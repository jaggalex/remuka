import {
  safeExternalUrl,
  type LineFormat,
  type TextDeltaOp,
  type TextMarks,
  type TextRun,
} from "@remo/model";
import { marksFromStyle, sizeOf, styleOf } from "./htmlStyle";
import { parseHtml, type HtmlElement } from "./htmlParser";
import { linesOf, normalizeDelta } from "./text";

export { marksFromStyle, styleOf } from "./htmlStyle";
export type { HtmlElement } from "./htmlParser";

/**
 * The HTML ↔ delta pair of the white list (ADR-252 §3).
 *
 * `deltaFromHtml` reads one clipboard fragment and keeps exactly what a note can store:
 * six inline marks and five line formats. It is not a page sanitiser — it is a reader
 * that throws away everything it has nowhere to put. `htmlFromDelta` is the writer, used
 * to seed the editor and to put a selection on the clipboard; the two names are one
 * vocabulary, so a round trip is the test.
 *
 * The input is parsed here rather than with `DOMParser` so the same rule runs in the
 * browser, in sync and in a test without a DOM. Styles are read from the `style`
 * attribute only: Google Docs' false-bold wrapper and a page's decorative CSS both pass
 * through the same check.
 */

/** Elements whose subtree is never text: a note has nowhere to put it. */
const DROPPED_TAGS = new Set([
  "audio",
  "canvas",
  "embed",
  "head",
  "iframe",
  "img",
  "link",
  "map",
  "math",
  "meta",
  "noscript",
  "object",
  "picture",
  "script",
  "source",
  "style",
  "svg",
  "template",
  "title",
  "track",
  "video",
]);

/** Tags that end the line they close, whatever the CSS says. */
const BLOCK_TAGS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "dd",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul",
]);

/* ------------------------------------------------------------------ styles --- */

/** The marks one element adds: its tag, then its own style over it. */
function marksForTag(element: HtmlElement, base: TextMarks): TextMarks {
  const next: TextMarks = { ...base };
  switch (element.tag) {
    case "b":
    case "strong":
      next.bold = true;
      break;
    case "i":
    case "em":
      next.italic = true;
      break;
    case "u":
      next.underline = true;
      break;
    case "s":
    case "strike":
    case "del":
      next.strike = true;
      break;
    case "code":
    case "kbd":
    case "samp":
    case "tt":
      next.code = true;
      break;
    case "font":
      if (/mono/i.test(element.attributes.face ?? "")) next.code = true;
      break;
    case "a": {
      const href = element.attributes.href ? safeExternalUrl(element.attributes.href) : null;
      if (href) next.href = href;
      break;
    }
    default:
      break;
  }

  const marked = marksFromStyle(next, element.attributes);
  // The Docs wrapper is not bold even when a style is missing: the id is the tell.
  if ((element.attributes.id ?? "").startsWith("docs-internal-guid")) delete marked.bold;
  if (marked.href) delete marked.underline;
  return marked;
}

/* --------------------------------------------------------------- structure --- */

interface Char {
  ch: string;
  marks: TextMarks;
  /** Nearest explicit font size, for Word's all-bold heading heuristic. */
  size?: number;
}

interface Line {
  chars: Char[];
  raw: boolean;
  block?: LineFormat["block"];
  indent: 0 | 1 | 2;
  checked: boolean;
  /** A block already produced this line and closed empty: the next one starts anew. */
  emptyBlock: boolean;
}

interface WalkContext {
  marks: TextMarks;
  size?: number;
  /** Number of `ul`/`ol` ancestors; the innermost tag decides the kind. */
  listDepth: number;
  listTag?: "ul" | "ol";
  /** The enclosing `ul`/`ol` is a checklist. */
  listCheck?: boolean;
  inItem: boolean;
  itemShape?: { block?: LineFormat["block"]; indent: 0 | 1 | 2; checked: boolean };
  /** Table cells are inline: a block inside a cell does not start a line. */
  suppressBlocks?: boolean;
}

function isBlockTag(tag: string): boolean {
  return BLOCK_TAGS.has(tag);
}

/** A block whose children are blocks is a wrapper, not a line of its own. */
function isWrapper(element: HtmlElement): boolean {
  if (!element.children.length) return false;
  let blockChild = false;
  for (const child of element.children) {
    if (typeof child === "string") {
      if (child.trim()) return false;
      continue;
    }
    if (isBlockTag(child.tag)) blockChild = true;
    else return false;
  }
  return blockChild;
}

/** A `br` that only keeps an empty line open is not a second line. */
function isCaretBreak(element: HtmlElement): boolean {
  return element.children.length === 1 && (element.children[0] as HtmlElement).tag === "br";
}

function clampIndent(value: number): 0 | 1 | 2 {
  if (value >= 2) return 2;
  if (value <= 0) return 0;
  return value === 1 ? 1 : 0;
}

/** A checkbox anywhere inside the item, the GitHub and Notion task-list tell. */
function checkboxOf(element: HtmlElement): { found: boolean; checked: boolean } {
  let found = false;
  let checked = false;
  const walk = (node: HtmlElement): void => {
    if (node.tag === "input" && (node.attributes.type ?? "").toLowerCase() === "checkbox") {
      found = true;
      if ("checked" in node.attributes) checked = true;
    }
    // Notion paints its own box and keeps the state on the wrapper.
    const own = node.attributes["data-checked"];
    if (own != null) {
      found = true;
      checked = own === "true";
    }
    for (const child of node.children) {
      if (typeof child !== "string") walk(child);
    }
  };
  walk(element);
  return { found, checked };
}

/** Is this list item a checklist item, and is it ticked? */
function checkStateOf(element: HtmlElement, context: WalkContext): boolean | null {
  const marker = `${element.attributes.class ?? ""} ${element.attributes["data-type"] ?? ""}`;
  const task =
    context.listCheck === true || /task-list-item|to[-_]?do|checklist|checkbox/i.test(marker);
  const box = checkboxOf(element);
  const own = element.attributes["data-checked"];
  if (!task && !box.found && own == null) return null;
  if (own === "true") return true;
  if (own === "false") return false;
  if (box.found) return box.checked;
  return false;
}

/** The block a list item reports, from its list and its own markers. */
function itemBlockOf(element: HtmlElement, context: WalkContext): LineFormat["block"] | undefined {
  const check = checkStateOf(element, context);
  if (check != null) return "check";
  if (context.listTag === "ol") return "ordered";
  if (context.listTag === "ul") return "bullet";
  return undefined;
}

/* ------------------------------------------------------------- html → delta --- */

/**
 * Delta of a clipboard HTML fragment, with only what a note stores.
 *
 * Lines come from the block tags, their format from `h1`…`h6`, `ul`/`ol` nesting and a
 * checkbox; a line's format lives on the `\n` that ends it, exactly as the editor's own
 * reader produces it. Inline marks come from tags and from the `style` attribute.
 */
export function deltaFromHtml(html: string): TextDeltaOp[] {
  const root = parseHtml(html);
  const lines: Line[] = [];
  let current: Line | null = null;

  const blank = (shape: Partial<Line> = {}): Line => ({
    chars: [],
    raw: false,
    indent: 0,
    checked: false,
    emptyBlock: false,
    ...shape,
  });

  const addLine = (shape: Partial<Line> = {}, reuseEmpty = false): Line => {
    if (!current) {
      current = blank(shape);
      lines.push(current);
      return current;
    }
    if (reuseEmpty && !current.chars.length && !current.emptyBlock && !current.raw) {
      Object.assign(current, shape);
      return current;
    }
    current = blank(shape);
    lines.push(current);
    return current;
  };

  const shapeOf = (line: Line): Partial<Line> => ({
    block: line.block,
    indent: line.indent,
    checked: line.checked,
  });

  const pushChar = (ch: string, context: WalkContext): void => {
    if (!current) addLine(context.itemShape ?? {});
    current!.chars.push({ ch, marks: { ...context.marks }, size: context.size });
  };

  const appendText = (text: string, context: WalkContext): void => {
    const normalized = text.replace(/[ \t\n\r\f]+/g, " ");
    for (const ch of normalized) pushChar(ch, context);
  };

  /** Text of a table cell: no line starts inside it, `br` is a space. */
  const collectInline = (element: HtmlElement, context: WalkContext): Char[] => {
    const chars: Char[] = [];
    const walk = (node: HtmlElement, inside: WalkContext): void => {
      if (DROPPED_TAGS.has(node.tag)) return;
      if (node.tag === "br") {
        chars.push({ ch: " ", marks: { ...inside.marks }, size: inside.size });
        return;
      }
      const next: WalkContext = { ...inside, ...marksAndSize(node, inside) };
      for (const child of node.children) {
        if (typeof child === "string") {
          for (const ch of child.replace(/[ \t\n\r\f]+/g, " ")) {
            chars.push({ ch, marks: { ...next.marks }, size: next.size });
          }
          continue;
        }
        walk(child, next);
      }
    };
    walk(element, { ...context, suppressBlocks: true });
    return chars;
  };

  const walkPre = (element: HtmlElement, context: WalkContext): void => {
    addLine({ ...(context.itemShape ?? {}), raw: true });
    const code: WalkContext = { ...context, marks: { ...context.marks, code: true } };
    const walk = (node: HtmlElement): void => {
      if (DROPPED_TAGS.has(node.tag)) return;
      const next: WalkContext = { ...code, ...marksAndSize(node, code) };
      for (const child of node.children) {
        if (typeof child === "string") {
          for (const ch of child) {
            if (ch === "\n") addLine({ ...(context.itemShape ?? {}), raw: true });
            else pushChar(ch, next);
          }
          continue;
        }
        walk(child);
      }
    };
    for (const child of element.children) {
      if (typeof child === "string") {
        for (const ch of child) {
          if (ch === "\n") addLine({ ...(context.itemShape ?? {}), raw: true });
          else pushChar(ch, code);
        }
      } else {
        walk(child);
      }
    }
  };

  const walk = (element: HtmlElement, context: WalkContext): void => {
    const tag = element.tag;
    if (DROPPED_TAGS.has(tag)) return;
    if (context.suppressBlocks) {
      for (const char of collectInline(element, context)) {
        if (!current) addLine(context.itemShape ?? {});
        current!.chars.push(char);
      }
      return;
    }

    if (tag === "br") {
      addLine(current ? shapeOf(current) : (context.itemShape ?? {}));
      return;
    }

    if (tag === "ul" || tag === "ol") {
      const check =
        tag === "ul" &&
        (element.attributes["data-check"] === "true" ||
          /to[-_]?do|checklist/i.test(`${element.attributes["data-type"] ?? ""}`));
      for (const child of element.children) {
        if (typeof child !== "string") {
          walk(child, {
            ...context,
            listDepth: context.listDepth + 1,
            listTag: tag,
            listCheck: check,
          });
        }
      }
      return;
    }

    if (tag === "table" || tag === "thead" || tag === "tbody" || tag === "tfoot") {
      for (const child of element.children) {
        if (typeof child !== "string") walk(child, context);
      }
      return;
    }

    if (tag === "tr") {
      addLine(context.itemShape ?? {});
      const cells: Char[][] = [];
      for (const child of element.children) {
        if (typeof child === "string") continue;
        if (child.tag !== "td" && child.tag !== "th") continue;
        const chars = collectInline(child, context);
        while (chars[0]?.ch === " ") chars.shift();
        while (chars[chars.length - 1]?.ch === " ") chars.pop();
        if (chars.length) cells.push(chars);
      }
      cells.forEach((chars, index) => {
        if (index) for (const ch of " \u00b7 ") pushChar(ch, context);
        for (const char of chars) current!.chars.push(char);
      });
      return;
    }

    if (tag === "pre") {
      walkPre(element, context);
      return;
    }

    if (tag === "li") {
      const dataIndent = element.attributes["data-indent"];
      const indent =
        dataIndent != null
          ? clampIndent(Number(dataIndent))
          : clampIndent(context.listDepth - 1);
      const block = itemBlockOf(element, context);
      const checked = checkStateOf(element, context) === true;
      const shape = { block, indent, checked };
      addLine({ ...shape, emptyBlock: false }, context.inItem);
      const item: WalkContext = { ...context, inItem: true, itemShape: shape };
      const before = current;
      for (const child of element.children) {
        if (typeof child === "string") appendText(child, item);
        else walk(child, item);
      }
      if (current === before && before && !before.chars.length) before.emptyBlock = true;
      return;
    }

    if (tag === "h1" || tag === "h2" || tag === "h3" || tag === "h4" || tag === "h5" || tag === "h6") {
      addLine({ block: tag === "h1" ? "h1" : "h2", emptyBlock: false });
      const heading: WalkContext = { ...context, marks: marksForTag(element, context.marks) };
      if (isCaretBreak(element)) {
        if (current) current.emptyBlock = true;
        return;
      }
      for (const child of element.children) {
        if (typeof child === "string") appendText(child, heading);
        else walk(child, heading);
      }
      if (current && !current.chars.length) current.emptyBlock = true;
      return;
    }

    if (isWrapper(element)) {
      const inside: WalkContext = { ...context, ...marksAndSize(element, context) };
      for (const child of element.children) {
        if (typeof child !== "string") walk(child, inside);
      }
      return;
    }

    if (isBlockTag(tag)) {
      const dataBlock = element.attributes["data-block"] as LineFormat["block"] | undefined;
      const shape: Partial<Line> = dataBlock
        ? {
            block: dataBlock,
            indent: clampIndent(Number(element.attributes["data-indent"] ?? 0)),
            checked: element.attributes["data-checked"] === "true",
          }
        : {};
      addLine({ ...(context.itemShape ?? {}), ...shape }, context.inItem);
      const blockContext: WalkContext = { ...context, marks: marksForTag(element, context.marks) };
      if (isCaretBreak(element)) {
        if (current) current.emptyBlock = true;
        return;
      }
      for (const child of element.children) {
        if (typeof child === "string") appendText(child, blockContext);
        else walk(child, blockContext);
      }
      if (current && !current.chars.length) current.emptyBlock = true;
      return;
    }

    // Everything else is inline: its text joins the current line with its marks.
    const inline: WalkContext = { ...context, ...marksAndSize(element, context) };
    if (isCaretBreak(element)) return;
    for (const child of element.children) {
      if (typeof child === "string") appendText(child, inline);
      else walk(child, inline);
    }
  };

  for (const child of root.children) {
    if (typeof child === "string") {
      const text = child.replace(/[ \t\n\r\f]+/g, " ");
      if (text.trim()) appendText(text, { marks: {}, listDepth: 0, inItem: false });
      continue;
    }
    walk(child, { marks: {}, listDepth: 0, inItem: false });
  }

  return normalizeDelta(deltaOfLines(lines));
}

function marksAndSize(element: HtmlElement, context: WalkContext): Partial<WalkContext> {
  const style = styleOf(element.attributes.style);
  const size = sizeOf(style) ?? context.size;
  return { marks: marksForTag(element, context.marks), size };
}

/**
 * Lines to operations: inline runs, then the `\n` that carries the line's format.
 *
 * The last line gets a terminating newline only when it has a format, exactly as the
 * editor writes it — a plain note must not gain an empty last line (ADR-252 §2.2).
 */
function deltaOfLines(lines: Line[]): TextDeltaOp[] {
  // Browser-like normalisation: no spaces at a line edge, no run of spaces, no run of
  // blank lines, no leading or trailing blank line.
  for (const line of lines) {
    if (line.raw) continue;
    while (line.chars[0]?.ch === " ") line.chars.shift();
    while (line.chars[line.chars.length - 1]?.ch === " ") line.chars.pop();
    line.chars = line.chars.filter(
      (char, index) => !(char.ch === " " && line.chars[index - 1]?.ch === " "),
    );
  }

  applyWordHeadings(lines);

  const kept: Line[] = [];
  for (const line of lines) {
    if (!line.chars.length && (!kept.length || !kept[kept.length - 1]!.chars.length)) continue;
    kept.push(line);
  }
  while (kept.length && !kept[kept.length - 1]!.chars.length) kept.pop();

  const out: TextDeltaOp[] = [];
  kept.forEach((line, index) => {
    for (const char of line.chars) {
      const marks: TextMarks = { ...char.marks };
      if (marks.href) delete marks.underline;
      out.push(
        Object.keys(marks).length
          ? { insert: char.ch, attributes: marks }
          : { insert: char.ch },
      );
    }
    const format = lineFormatOf(line);
    const last = index === kept.length - 1;
    if (!last || format.block) {
      out.push(
        Object.keys(format).length
          ? { insert: "\n", attributes: format }
          : { insert: "\n" },
      );
    }
  });
  return out;
}

function lineFormatOf(line: Line): LineFormat {
  const format: LineFormat = {};
  if (line.block) format.block = line.block;
  if (
    (line.block === "bullet" || line.block === "ordered" || line.block === "check") &&
    line.indent
  ) {
    format.indent = line.indent;
  }
  if (line.block === "check" && line.checked) format.checked = true;
  return format;
}

function modal(values: number[]): number | undefined {
  if (!values.length) return undefined;
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: number | undefined;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Word's headings are paragraphs that are entirely bold and bigger than the body.
 *
 * The body size is the commonest explicit size in the fragment; a line qualifies when
 * every visible character is bold and the smallest size on the line is at least 1.3×
 * that. Nothing else can produce the pattern by accident.
 */
function applyWordHeadings(lines: Line[]): void {
  const sizes: number[] = [];
  for (const line of lines) {
    for (const char of line.chars) {
      if (char.size) sizes.push(Math.round(char.size * 10) / 10);
    }
  }
  const body = modal(sizes);
  if (!body) return;
  for (const line of lines) {
    if (line.block || !line.chars.length) continue;
    if (!line.chars.every((char) => char.marks.bold && char.size)) continue;
    const smallest = Math.min(...line.chars.map((char) => char.size ?? 0));
    if (smallest >= body * 1.3 - 0.01) line.block = "h2";
  }
}

/* ------------------------------------------------------------- delta → html --- */

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

const MARK_TAGS: ReadonlyArray<readonly [keyof TextMarks, string]> = [
  ["bold", "b"],
  ["italic", "i"],
  ["underline", "u"],
  ["strike", "s"],
];

/** One run with its marks nested the way the reader accumulates them. */
function runHtml(run: TextRun): string {
  let open = "";
  let close = "";
  for (const [mark, tag] of MARK_TAGS) {
    if (!run[mark]) continue;
    open += `<${tag}>`;
    close = `</${tag}>${close}`;
  }
  if (run.code) {
    open += "<code>";
    close = `</code>${close}`;
  }
  if (run.href) {
    open += `<a href="${escapeAttribute(run.href)}" rel="noopener noreferrer">`;
    close = `</a>${close}`;
  }
  return `${open}${escapeHtml(run.text)}${close}`;
}

function lineBody(runs: readonly TextRun[]): string {
  return runs.map(runHtml).join("");
}

export interface HtmlFromDeltaOptions {
  /**
   * Write the clipboard flavour: `h1`/`h2`, `ul`/`ol`/`li` and checkboxes, so other
   * applications see a document. The default is the editor flavour — one `div` per line
   * with the format in `data-*` (ADR-252 §3, §5.1).
   */
  clipboard?: boolean;
}

function editorLine(line: ReturnType<typeof linesOf>[number]): string {
  const attributes: string[] = [];
  if (line.block) attributes.push(`data-block="${line.block}"`);
  if (line.indent) attributes.push(`data-indent="${line.indent}"`);
  if (line.block === "check" && line.checked) attributes.push(`data-checked="true"`);
  if (line.block === "ordered" && line.ordinal) attributes.push(`data-ordinal="${line.ordinal}"`);
  const extra = attributes.length ? ` ${attributes.join(" ")}` : "";
  return `<div${extra}>${lineBody(line.runs) || "<br>"}</div>`;
}

function clipboardLine(line: ReturnType<typeof linesOf>[number]): string {
  if (line.block === "h1" || line.block === "h2") return `<${line.block}>${lineBody(line.runs)}</${line.block}>`;
  const body = lineBody(line.runs);
  return `<p>${body || "<br>"}</p>`;
}

function clipboardList(kind: "bullet" | "ordered" | "check"): string {
  return kind === "ordered" ? "ol" : "ul";
}

/**
 * Delta to HTML — the editor's seed and the clipboard's `text/html` (ADR-252 §3, §5.5).
 *
 * The editor needs one `div` per line and the block format in `data-*`; a clipboard
 * needs the semantic tags other applications understand. Both come from this function
 * so there is one writer, and `deltaFromHtml` reads both back.
 */
export function htmlFromDelta(
  delta: readonly TextDeltaOp[],
  options: HtmlFromDeltaOptions = {},
): string {
  const lines = linesOf(delta);
  if (!options.clipboard) return lines.map(editorLine).join("");

  const out: string[] = [];
  let openList: "bullet" | "ordered" | "check" | null = null;
  const closeList = (): void => {
    if (!openList) return;
    out.push(`</${clipboardList(openList)}>`);
    openList = null;
  };

  for (const line of lines) {
    const kind =
      line.block === "bullet" || line.block === "ordered" || line.block === "check"
        ? line.block
        : null;
    if (kind !== openList) {
      closeList();
      if (kind) {
        openList = kind;
        out.push(
          kind === "check" ? `<ul data-check="true">` : `<${clipboardList(kind)}>`,
        );
      }
    }

    if (!kind) {
      out.push(clipboardLine(line));
      continue;
    }

    const attributes: string[] = [];
    if (line.indent) attributes.push(`data-indent="${line.indent}"`);
    if (kind === "check") {
      attributes.push(`data-checked="${line.checked ? "true" : "false"}"`);
      const box = line.checked ? `<input type="checkbox" checked disabled>` : `<input type="checkbox" disabled>`;
      const extra = attributes.length ? ` ${attributes.join(" ")}` : "";
      out.push(`<li${extra}>${box}${lineBody(line.runs)}</li>`);
      continue;
    }
    const extra = attributes.length ? ` ${attributes.join(" ")}` : "";
    out.push(`<li${extra}>${lineBody(line.runs)}</li>`);
  }
  closeList();
  return out.join("");
}
