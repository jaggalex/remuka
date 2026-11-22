import {
  canonicalLineFormat,
  deltaFromHtml,
  htmlFromDelta,
  isMarkdown,
  linesOf,
  marksFromStyle,
  normalizeDelta,
  parseMarkdown,
  toMarkdown,
  type LineFormatInput,
  type NoteDirection,
} from "@remo/doc";
import type { LineFormat, TextDeltaOp, TextLine, TextMarks, TextRun } from "@remo/model";
import {
  applyLineFormat,
  caretAtLineEnd,
  lineElementAt,
  lineFormatOf,
  lineText,
  placeCaretAtEndOfLine,
  placeCaretAtStart,
  shapeOfElement,
  splitLine,
  type LineShape,
} from "./textLineDom";

/**
 * Rich text between the DOM and the document.
 *
 * The editor is a `contentEditable` element, so the browser owns the caret and the
 * selection; the document only ever sees a delta. These two functions are the only
 * place that knows about that boundary, which keeps the parsing honest: what the
 * painter draws comes from the delta, and the delta comes from exactly the marks
 * below — nothing else in the DOM can leak into a note.
 *
 * Since ADR-252 §5.1 a line of the editor is one `div`: the block format (heading, list,
 * checklist) lives in `data-*` on that div and is stored on the `\n` that ends the line.
 * The reader and the writer here are the web half of the pair; stage 6 moves them to
 * `packages/doc/src/html.ts` so paste and copy share them with the API.
 */

const MARK_TAGS: ReadonlyArray<readonly [keyof TextMarks, string]> = [
  ["bold", "b"],
  ["italic", "i"],
  ["underline", "u"],
  ["strike", "s"],
];

/** Tags that end the line they close, whoever produced them. */
const BLOCK_ELEMENTS = new Set([
  "div",
  "p",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "pre",
  "tr",
  "section",
  "article",
  "header",
  "footer",
]);

interface DomLine extends LineShape {
  ops: TextDeltaOp[];
}

/** Plain text of a delta — what the note's height and the presence label use. */
export function deltaText(delta: readonly TextDeltaOp[]): string {
  return delta.map((op) => op.insert).join("");
}

/**
 * The delta a clipboard payload becomes (ADR-252 §5.4, stage 1).
 *
 * `html` wins whenever it is present: a page, Google Docs, Notion or Word all put their
 * structure there, and the plain text beside it is only a fallback. Markdown is read
 * only when there is no HTML at all, and never in `plain` mode — ⌘⇧V is the promise that
 * the text arrives exactly as copied.
 */
export function pasteDelta(input: {
  html: string | null;
  text: string | null;
  plain?: boolean;
}): TextDeltaOp[] {
  const html = input.html?.trim() ? input.html : null;
  const text = (input.text ?? "").replace(/\r\n?/g, "\n");
  if (input.plain) return text ? [{ insert: text }] : [];

  if (html) {
    const delta = deltaFromHtml(html);
    // A fragment that carried only pictures or scripts has no text of its own; the
    // plain text beside it is a better answer than nothing.
    if (delta.length || !text.trim()) return delta;
  }
  if (!text) return [];
  if (isMarkdown(text)) return parseMarkdown(text);
  return [{ insert: text }];
}

function push(out: TextDeltaOp[], text: string, marks: TextMarks): void {
  if (!text) return;
  out.push(
    Object.keys(marks).length ? { insert: text, attributes: { ...marks } } : { insert: text },
  );
}

/** Marks one element adds to the ones it inherits. */
function marksForElement(element: HTMLElement, marks: TextMarks): TextMarks {
  let next: TextMarks = { ...marks };
  const tag = element.tagName.toLowerCase();
  if (tag === "b" || tag === "strong") next = { ...next, bold: true };
  if (tag === "i" || tag === "em") next = { ...next, italic: true };
  if (tag === "u") next = { ...next, underline: true };
  if (tag === "s" || tag === "strike" || tag === "del") next = { ...next, strike: true };
  if (tag === "code" || tag === "kbd" || tag === "samp") next = { ...next, code: true };
  if (tag === "a") {
    const href = element.getAttribute("href");
    // The document narrows the scheme in `canonicalAttributes`; the editor only
    // reports what the anchor says, so an unsafe address never becomes stored text.
    if (href) next = { ...next, href };
  }
  // The same style reader the clipboard uses (ADR-252 §3), so the editor and a paste
  // cannot disagree about `font-weight: 700` or a monospace family.
  next = marksFromStyle(next, { style: element.getAttribute("style") ?? "" });
  if (next.href) delete next.underline;
  return next;
}

/**
 * Delta of what is currently in the editor's DOM.
 *
 * Every top-level `div` is a line. A `br` inside one is a line boundary too, except a
 * `br` that ends the container: that is how the browser keeps a caret on an empty line,
 * and HTML draws no extra line for it. The last line carries its block format on a
 * terminating `\n`, which is not an empty line (ADR-252 §2.2).
 */
export function deltaFromDom(root: Node): TextDeltaOp[] {
  const lines: DomLine[] = [];
  let current: DomLine | null = null;

  const start = (shape: LineShape): DomLine => {
    const line: DomLine = { ops: [], ...shape };
    lines.push(line);
    current = line;
    return line;
  };
  const ensure = (): DomLine => current ?? start({ indent: 0, checked: false });

  const appendText = (value: string, marks: TextMarks): void => {
    if (!value) return;
    const line = ensure();
    const last = line.ops[line.ops.length - 1];
    const same =
      last &&
      marksKey(last.attributes) === marksKey(marks);
    if (same) {
      last.insert += value;
      return;
    }
    push(line.ops, value, marks);
  };

  const walkInline = (container: Node, shape: LineShape, marks: TextMarks): boolean => {
    let endedWithBreak = false;
    for (const child of Array.from(container.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        // Zero-width characters are a caret artefact of `contentEditable`.
        appendText((child.nodeValue ?? "").replace(/\u200b/g, ""), marks);
        endedWithBreak = false;
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;

      const element = child as HTMLElement;
      const tag = element.tagName.toLowerCase();
      if (tag === "br") {
        start(shape);
        endedWithBreak = true;
        continue;
      }
      if (BLOCK_ELEMENTS.has(tag)) {
        walkBlock(element, marks);
        endedWithBreak = false;
        continue;
      }
      endedWithBreak = walkInline(element, shape, marksForElement(element, marks));
    }
    return endedWithBreak;
  };

  const walkBlock = (element: HTMLElement, marks: TextMarks): void => {
    const shape = shapeOfElement(element, root);
    const first = lines.length;
    start(shape);
    const ended = walkInline(element, shape, marks);
    // A trailing `br` only holds the caret; drop the empty line it opened unless it is
    // the block's only line, which is exactly the empty line itself.
    const last = lines[lines.length - 1];
    if (ended && last && !last.ops.length && lines.length > first + 1) {
      lines.pop();
      current = lines[lines.length - 1] ?? null;
    }
  };

  const first = lines.length;
  const rootFormat: LineShape = { indent: 0, checked: false };
  const ended = walkInline(root, rootFormat, {});
  const trailing = lines[lines.length - 1];
  if (ended && trailing && !trailing.ops.length && lines.length > first + 1) {
    lines.pop();
    current = lines[lines.length - 1] ?? null;
  }

  const out: TextDeltaOp[] = [];
  lines.forEach((line, index) => {
    for (const op of line.ops) out.push(op);
    const format = canonicalLineFormat({
      block: line.block,
      indent: line.indent || undefined,
      checked: line.checked || undefined,
    });
    const last = index === lines.length - 1;
    // A formatted last line needs its terminating `\n`; a plain one must not grow one,
    // or every note would gain an empty line when it is opened (ADR-252 §2.2).
    if (!last || format.block) {
      out.push(Object.keys(format).length ? { insert: "\n", attributes: format } : { insert: "\n" });
    }
  });
  return normalizeDelta(out);
}

function marksKey(marks?: TextMarks): string {
  if (!marks) return "";
  return [
    marks.bold ? "b" : "",
    marks.italic ? "i" : "",
    marks.underline ? "u" : "",
    marks.strike ? "s" : "",
    marks.code ? "c" : "",
    marks.href ?? "",
  ].join("\u0000");
}

/* ------------------------------------------------------------------ lines --- */

export type LineBlock = NonNullable<LineFormat["block"]>;

/** What a key does to the line or the selection, decided without the DOM (§5.3). */
export type LineKeyAction =
  | { type: "none" }
  | { type: "close" }
  | { type: "stay" }
  | { type: "mark"; mark: "bold" | "italic" | "underline" | "strike" }
  | { type: "code" }
  | { type: "link" }
  | { type: "clearFormatting" }
  | { type: "plainPaste" }
  | { type: "toggleBlock"; block: LineBlock }
  | { type: "setBlock"; block: LineBlock | null }
  | { type: "indent"; indent: 0 | 1 | 2 }
  | { type: "enter"; exitList: boolean }
  | { type: "newBullet" }
  | { type: "clearLine" }
  | { type: "mergeUp" }
  | { type: "cancelRule" }
  | { type: "chain"; direction: NoteDirection };

export interface LineKeyInput {
  key: string;
  /** Physical key, so `⌘⇧7` works on a layout where Shift+7 is `&`. */
  code?: string;
  /** ⌘ on macOS, Ctrl elsewhere. */
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
  /** The object takes headings, lists and checklists (ADR-252 §2.5). */
  richBlocks?: boolean;
  block?: LineFormat["block"];
  indent?: 0 | 1 | 2;
  /** The caret is collapsed at the very start of its line. */
  atStart?: boolean;
  /** The line has no characters. */
  empty?: boolean;
  /** There is a line above this one. */
  hasPrevious?: boolean;
  /** A Markdown input rule fired on this line and nothing has been typed since. */
  rulePending?: boolean;
}

function isList(block: LineFormat["block"] | undefined): boolean {
  return block === "bullet" || block === "ordered" || block === "check";
}

/** The keys of an editor line, in one place, so the browser and the document agree. */
export function lineKeyAction(input: LineKeyInput): LineKeyAction {
  const key = input.key;
  const code = input.code ?? "";
  const shift = Boolean(input.shift);
  const alt = Boolean(input.alt);
  const rich = Boolean(input.richBlocks);
  const block = input.block;
  const indent = input.indent ?? 0;

  if (key === "Escape") return { type: "close" };

  if (input.meta) {
    if (key === "Enter") return { type: "close" };
    const letter = key.toLowerCase();
    if (letter === "v" && shift) return { type: "plainPaste" };
    // ⌘⇧X is strike from stage 1 on; clearing formatting is ⌘\ (ADR-252 §5.3).
    if (letter === "x" && shift) return { type: "mark", mark: "strike" };
    if (!shift && !alt && (letter === "b" || letter === "i" || letter === "u")) {
      return { type: "mark", mark: letter === "b" ? "bold" : letter === "i" ? "italic" : "underline" };
    }
    // ⌘E is inline code and ⌘K the link window (ADR-252 §5.3, §6).
    if (!shift && !alt && letter === "e") return { type: "code" };
    if (!shift && !alt && letter === "k") return { type: "link" };
    if (key === "\\") return { type: "clearFormatting" };
    if (shift && !alt) {
      if (code === "Digit7") return { type: "toggleBlock", block: "ordered" };
      if (code === "Digit8") return { type: "toggleBlock", block: "bullet" };
      if (code === "Digit9") return { type: "toggleBlock", block: "check" };
    }
    if (alt && !shift) {
      if (code === "Digit1") return { type: "toggleBlock", block: "h1" };
      if (code === "Digit2") return { type: "toggleBlock", block: "h2" };
      if (code === "Digit0") return { type: "setBlock", block: null };
    }
    return { type: "none" };
  }

  if (key === "Tab") {
    if (!rich) return { type: "chain", direction: shift ? "left" : "right" };
    if (isList(block)) {
      // The floor of a list is level 0; the ceiling is level 2 (§2.1).
      if (shift) return { type: "indent", indent: Math.max(0, indent - 1) as 0 | 1 | 2 };
      return { type: "indent", indent: Math.min(2, indent + 1) as 0 | 1 | 2 };
    }
    // Tab on an ordinary line starts a list; Shift+Tab keeps ADR-028's chain. A
    // heading has no level to change, so Tab must not rewrite it into a bullet.
    if (shift) return { type: "chain", direction: "left" };
    if (block) return { type: "stay" };
    return { type: "newBullet" };
  }

  if (key === "Enter") {
    // Alt+Enter grows a chain of notes (ADR-028), and so does Tab outside this file.
    if (alt) return { type: "chain", direction: shift ? "up" : "down" };
    if (!rich) return { type: "none" };
    return { type: "enter", exitList: isList(block) && Boolean(input.empty) };
  }

  if (key === "Backspace" && input.atStart) {
    // Backspace right after a rule gives the marker back as text (§5.2).
    if (input.rulePending) return { type: "cancelRule" };
    if (rich && block) {
      if (isList(block) && indent > 0) return { type: "indent", indent: (indent - 1) as 0 | 1 | 2 };
      return { type: "clearLine" };
    }
    if (input.hasPrevious) return { type: "mergeUp" };
  }

  return { type: "none" };
}

/**
 * The format a line gets when a block shortcut is pressed.
 *
 * `null` means "clear": pressing the shortcut of the format the line already has removes
 * it, which is what every editor does. A list keeps its level when it turns into another
 * kind of list, so `⌘⇧7` on a nested bullet does not lose the nesting.
 */
export function lineFormatFor(
  target: LineBlock | null,
  current: { block?: LineFormat["block"]; indent?: 0 | 1 | 2 },
): LineFormatInput | null {
  if (!target) return null;
  if (current.block === target) return null;
  const keepIndent =
    target !== "h1" &&
    target !== "h2" &&
    isList(current.block) &&
    (current.indent === 1 || current.indent === 2)
      ? current.indent
      : undefined;
  return { block: target, ...(keepIndent ? { indent: keepIndent } : {}) };
}

/** A Markdown marker typed at the start of a line and turned into a block (§5.2). */
export interface MarkdownShortcut {
  /** Characters to remove: the marker and the space that fired it. */
  remove: number;
  block: LineBlock;
  checked?: boolean;
}

/**
 * The Markdown input rules, as one table.
 *
 * They fire only when the line is exactly a marker and the space after it, and only
 * while the person is typing it: a `- ` in the middle of a sentence is text. `> ` is out
 * of v1 (§5.2) and so is a code fence until a later stage.
 */
export function markdownShortcut(
  line: string,
  options: { enabled?: boolean } = {},
): MarkdownShortcut | null {
  if (options.enabled === false) return null;
  const text = line.replace(/\u00a0/g, " ");
  const match = /^(#{1,2}|[-*+]|\d{1,9}[.)]|\[[ xX]?\])( )$/.exec(text);
  if (!match) return null;
  const marker = match[1]!;
  if (marker === "#") return { remove: text.length, block: "h1" };
  if (marker === "##") return { remove: text.length, block: "h2" };
  if (marker === "-" || marker === "*" || marker === "+") {
    return { remove: text.length, block: "bullet" };
  }
  if (marker.startsWith("[")) {
    return {
      remove: text.length,
      block: "check",
      ...(/\[[xX]\]/.test(marker) ? { checked: true } : {}),
    };
  }
  return { remove: text.length, block: "ordered" };
}

/**
 * The DOM of one run: only the tags `deltaFromDom` reads back.
 *
 * Nodes are built rather than parsed, so a note can never gain markup the model cannot
 * hold (ADR-252 §1, rule 3).
 */
function runNode(run: TextRun): Node {
  let node: Node = document.createTextNode(run.text);
  if (run.code) {
    const code = document.createElement("code");
    code.appendChild(node);
    node = code;
  }
  for (const [mark, tag] of [...MARK_TAGS].reverse()) {
    if (!run[mark]) continue;
    const element = document.createElement(tag);
    element.appendChild(node);
    node = element;
  }
  if (run.href) {
    const link = document.createElement("a");
    link.setAttribute("href", run.href);
    link.appendChild(node);
    node = link;
  }
  return node;
}

/** A line div carrying the format the writer of `htmlFromDelta` would have written. */
function lineElement(line: TextLine): HTMLElement {
  const element = document.createElement("div");
  applyLineFormat(element, {
    block: line.block,
    ...(line.indent ? { indent: line.indent } : {}),
    ...(line.checked ? { checked: true } : {}),
  });
  if (line.block === "ordered" && line.ordinal) element.dataset.ordinal = String(line.ordinal);
  for (const run of line.runs) element.appendChild(runNode(run));
  if (!element.childNodes.length) element.appendChild(document.createElement("br"));
  return element;
}

/** Put the caret after a node that has just been inserted. */
function collapseAfter(node: Node | undefined): void {
  if (!node) return;
  const range = document.createRange();
  range.setStartAfter(node);
  range.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

/**
 * Insert a delta at the caret, replacing the selection.
 *
 * Marks are explicit: the pasted characters carry their own attributes rather than
 * inheriting the ones around the caret. A delta with a line format (or more than one
 * line) splits the line under the caret the way every editor does (§5.4.8): the first
 * plain pasted line continues it, the rest become lines of their own, and the text after
 * the caret moves to the end. Returns `false` when there is no caret inside `root`.
 */
export function insertDeltaAtCaret(
  delta: readonly TextDeltaOp[],
  root: HTMLElement,
): boolean {
  if (!delta.length) return false;
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) return false;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return false;

  const lines = linesOf(delta);
  const line = lineElementAt(root, range.startContainer);
  const blocky = lines.length > 1 || lines.some((entry) => entry.block);

  if (!blocky || !line) {
    range.deleteContents();
    const nodes = (lines[0]?.runs ?? []).map(runNode);
    const fragment = document.createDocumentFragment();
    for (const node of nodes) fragment.appendChild(node);
    if (!fragment.childNodes.length) return false;
    range.insertNode(fragment);
    collapseAfter(nodes[nodes.length - 1]);
    return true;
  }

  range.deleteContents();
  const tail = caretAtLineEnd(range, line) ? null : splitLine(line, range, lineFormatOf(line));
  const mergedFirst = Boolean(lines[0] && !lines[0].block);
  if (mergedFirst && !lineText(line)) line.replaceChildren();

  let lastPlaced: Node | null = null;
  const place = (node: Node): void => {
    if (tail?.parentNode) {
      tail.parentNode.insertBefore(node, tail);
      return;
    }
    const base = lastPlaced ?? line;
    if (base.parentNode) base.parentNode.insertBefore(node, base.nextSibling);
    else root.appendChild(node);
    lastPlaced = node;
  };

  let caretTarget: HTMLElement | null = null;
  lines.forEach((entry, index) => {
    const first = index === 0;
    const last = index === lines.length - 1;
    if (first && !entry.block) {
      for (const run of entry.runs) line.appendChild(runNode(run));
      caretTarget = line;
      return;
    }
    // A trailing empty line is the line the caret's own tail already occupies.
    if (last && !entry.block && !entry.runs.length) return;
    const element = lineElement(entry);
    place(element);
    caretTarget = element;
  });

  // The seed line of a fresh note is not content when the paste brought its own blocks.
  if (!mergedFirst && !lineText(line)) line.remove();
  if (caretTarget) placeCaretAtEndOfLine(caretTarget);
  else if (tail) placeCaretAtStart(tail);
  return true;
}

/** Write the Markdown and HTML a selection should carry (§5.5). */
export function selectionPayload(root: HTMLElement): { html: string; text: string } | null {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (range.collapsed || !root.contains(range.commonAncestorContainer)) return null;

  const holder = document.createElement("div");
  holder.appendChild(range.cloneContents());
  // A selection inside one line brings no `div`; the reader still expects one line.
  if (!Array.from(holder.children).some((child) => child.tagName === "DIV")) {
    const line = document.createElement("div");
    while (holder.firstChild) line.appendChild(holder.firstChild);
    holder.appendChild(line);
  }
  const delta = deltaFromDom(holder);
  if (!delta.length) return null;
  return {
    html: htmlFromDelta(delta, { clipboard: true }),
    text: toMarkdown(delta),
  };
}

/**
 * Remove every mark from the selection, keeping the text — "Clear formatting" (⌘\).
 *
 * `removeFormat` is the browser's own answer and knows about the tags the editor puts
 * in the DOM; an engine without it leaves the text alone rather than damaging it.
 */
export function clearFormatting(): void {
  try {
    document.execCommand("removeFormat");
  } catch {
    // No command, no change: the text is untouched and the marks stay as they were.
  }
}

/** Apply a mark to the current selection, the way the toolbar buttons do. */
export function toggleMark(mark: keyof TextMarks): void {
  const command =
    mark === "bold"
      ? "bold"
      : mark === "italic"
        ? "italic"
        : mark === "underline"
          ? "underline"
          : "strikeThrough";
  try {
    document.execCommand(command);
  } catch {
    // An engine without execCommand simply has no toolbar formatting; typing and
    // the document are unaffected.
  }
}
