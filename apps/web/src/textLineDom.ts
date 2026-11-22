import { linesOf, type LineFormatInput } from "@remo/doc";
import type { LineFormat, TextDeltaOp } from "@remo/model";

/**
 * The line divs of the inline editor (ADR-252 §5.1).
 *
 * The editor is a `contentEditable` where one line is one `div` and the block format
 * (heading, list, checklist) lives in `data-*` on it. These helpers read and write that
 * structure and own the caret after Enter, Tab and Backspace. They know nothing about
 * the document: `richText.ts` turns a line into a delta and back, so the two halves stay
 * one boundary instead of two.
 */

/** The block formats the editor understands on a line div. */
const BLOCKS = new Set(["h1", "h2", "bullet", "ordered", "check"]);

/** What a line is in the accessibility tree (ADR-252 §9). */
export interface LineA11y {
  role: "heading" | "listitem" | "checkbox" | null;
  level?: 1 | 2;
  checked?: boolean;
}

/**
 * The role of a line, from its format.
 *
 * Structure rather than decoration: a heading is a heading, a checklist item is a
 * checkbox with its state, a list item is an item. The editor is a `textbox`, so these
 * roles sit inside it the way annotations sit in a document.
 */
export function lineA11y(format: LineFormatInput | null | undefined): LineA11y {
  switch (format?.block) {
    case "h1":
      return { role: "heading", level: 1 };
    case "h2":
      return { role: "heading", level: 2 };
    case "bullet":
    case "ordered":
      return { role: "listitem" };
    case "check":
      return { role: "checkbox", checked: format?.checked === true };
    default:
      return { role: null };
  }
}

/** Write the role and state onto a line div, or take them away with the format. */
export function applyLineA11y(element: HTMLElement, format: LineFormatInput | null): void {
  const a11y = lineA11y(format);
  if (!a11y.role) {
    element.removeAttribute("role");
    element.removeAttribute("aria-level");
    element.removeAttribute("aria-checked");
    return;
  }
  element.setAttribute("role", a11y.role);
  if (a11y.level) element.setAttribute("aria-level", String(a11y.level));
  else element.removeAttribute("aria-level");
  if (a11y.role === "checkbox") {
    element.setAttribute("aria-checked", a11y.checked ? "true" : "false");
  } else {
    element.removeAttribute("aria-checked");
  }
}

/** What a line div holds, beyond its inline runs. */
export interface LineShape {
  block?: LineFormat["block"];
  indent: 0 | 1 | 2;
  checked: boolean;
}

function indentOf(element: HTMLElement, root: Node): 0 | 1 | 2 {
  let depth = 0;
  let node: Node | null = element.parentNode;
  while (node && node !== root) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const tag = (node as HTMLElement).tagName.toLowerCase();
      if (tag === "ul" || tag === "ol") depth += 1;
    }
    node = node.parentNode;
  }
  return Math.min(2, Math.max(0, depth - 1)) as 0 | 1 | 2;
}

/** The line format a DOM element carries, from our `data-*` or a browser's own tags. */
export function shapeOfElement(element: HTMLElement, root: Node): LineShape {
  const block = element.dataset.block;
  if (block && BLOCKS.has(block)) {
    const indent = element.dataset.indent === "1" ? 1 : element.dataset.indent === "2" ? 2 : 0;
    return {
      block: block as LineFormat["block"],
      indent,
      checked: element.dataset.checked === "true",
    };
  }

  const tag = element.tagName.toLowerCase();
  if (tag === "h1" || tag === "h2") return { block: tag, indent: 0, checked: false };
  if (tag === "li") {
    const list = element.parentElement?.tagName.toLowerCase();
    const block = list === "ol" ? "ordered" : "bullet";
    return { block, indent: indentOf(element, root), checked: false };
  }
  return { indent: 0, checked: false };
}

/** The line divs of the editor, in document order. */
export function lineElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.children).filter(
    (child): child is HTMLElement => child.tagName === "DIV",
  );
}

/** The top-level line div that holds `node`, or null for a caret at the root. */
export function lineElementAt(root: HTMLElement, node: Node | null): HTMLElement | null {
  let current: Node | null = node;
  while (current && current !== root) {
    if (current.parentNode === root) {
      return current.nodeType === Node.ELEMENT_NODE && (current as HTMLElement).tagName === "DIV"
        ? (current as HTMLElement)
        : null;
    }
    current = current.parentNode;
  }
  return null;
}

/** The line format a line div carries; null for an ordinary line. */
export function lineFormatOf(element: HTMLElement): LineFormatInput | null {
  const shape = shapeOfElement(element, element.parentNode ?? element);
  if (!shape.block) return null;
  return {
    block: shape.block,
    ...(shape.indent ? { indent: shape.indent } : {}),
    ...(shape.checked ? { checked: true } : {}),
  };
}

/** Write a line format onto its div, or clear every format attribute. */
export function applyLineFormat(element: HTMLElement, format: LineFormatInput | null): void {
  applyLineA11y(element, format);
  const block = format?.block ?? undefined;
  if (!block) {
    delete element.dataset.block;
    delete element.dataset.indent;
    delete element.dataset.checked;
    delete element.dataset.ordinal;
    return;
  }
  element.dataset.block = block;
  if (
    (block === "bullet" || block === "ordered" || block === "check") &&
    (format?.indent === 1 || format?.indent === 2)
  ) {
    element.dataset.indent = String(format.indent);
  } else {
    delete element.dataset.indent;
  }
  if (block === "check" && format?.checked) element.dataset.checked = "true";
  else delete element.dataset.checked;
  if (block !== "ordered") delete element.dataset.ordinal;
}

/**
 * Re-apply the document's line structure to the existing divs.
 *
 * Used when only formats changed — a remote shortcut, a renumbered list — so the local
 * caret stays where it is instead of jumping to the end of a rebuilt editor.
 */
export function syncLineAttributes(root: HTMLElement, delta: readonly TextDeltaOp[]): void {
  const lines = linesOf(delta);
  const elements = lineElements(root);
  // A `br` inside a div means one div holds several lines; then the nth div is not the
  // nth line, and guessing would put a marker on the wrong row.
  if (elements.length !== lines.length) return;
  elements.forEach((element, index) => {
    const line = lines[index]!;
    applyLineFormat(element, {
      block: line.block,
      ...(line.indent ? { indent: line.indent } : {}),
      ...(line.checked ? { checked: true } : {}),
    });
    if (line.block === "ordered" && line.ordinal) {
      element.dataset.ordinal = String(line.ordinal);
    }
  });
}

/** The characters of one line, without the caret's zero-width artefacts. */
export function lineText(line: HTMLElement): string {
  return (line.textContent ?? "").replace(/\u200b/g, "");
}

/** The caret is collapsed at the very start of the line. */
export function caretAtLineStart(range: Range, line: HTMLElement): boolean {
  if (!range.collapsed) return false;
  const before = document.createRange();
  before.selectNodeContents(line);
  before.setEnd(range.startContainer, range.startOffset);
  return before.toString().replace(/\u200b/g, "") === "";
}

/** The caret is collapsed at the very end of the line. */
export function caretAtLineEnd(range: Range, line: HTMLElement): boolean {
  if (!range.collapsed) return false;
  const after = document.createRange();
  after.setStart(range.endContainer, range.endOffset);
  after.setEnd(line, line.childNodes.length);
  return after.toString().replace(/\u200b/g, "") === "";
}

/** Delete the first `count` characters of a line, across its text nodes. */
export function removeLinePrefix(line: HTMLElement, count: number): void {
  let left = count;
  const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const node of nodes) {
    if (left <= 0) break;
    const value = node.nodeValue ?? "";
    const take = Math.min(left, value.length);
    node.nodeValue = value.slice(take);
    left -= take;
  }
}

/** A div with no content needs a `br`, or it has neither height nor a caret. */
function keepLineHeight(line: HTMLElement): void {
  if (!line.childNodes.length) line.appendChild(document.createElement("br"));
}

/**
 * Split a line at the caret, for Enter (ADR-252 §5.3).
 *
 * The tail moves into a new div with the requested format; `br`s that only held the
 * caret are normalised so the reader does not see an extra line in either div.
 */
export function splitLine(
  line: HTMLElement,
  range: Range,
  format: LineFormatInput | null,
): HTMLElement {
  const tail = document.createRange();
  tail.setStart(range.startContainer, range.startOffset);
  tail.setEnd(line, line.childNodes.length);
  const fragment = tail.extractContents();

  const next = document.createElement("div");
  applyLineFormat(next, format);
  next.appendChild(fragment);
  // A split at the very edge of a mark can leave an empty clone (`<a></a>`) in the new
  // line. The reader never stores an empty run, so it must not stay in the DOM either.
  for (const mark of Array.from(
    next.querySelectorAll("a, code, b, i, u, s, strong, em, del, kbd, samp"),
  )) {
    if (!mark.textContent && !mark.querySelector("*")) mark.remove();
  }
  // A `br` carried over from the old line's caret is not a boundary at the start.
  if (next.childNodes.length > 1 && next.firstChild?.nodeName === "BR") {
    next.removeChild(next.firstChild);
  }
  keepLineHeight(next);
  line.after(next);
  keepLineHeight(line);
  placeCaretAtStart(next);
  return next;
}

/** Join a line to the one above it, Backspace at the start of a plain line. */
export function mergeLineUp(line: HTMLElement, previous: HTMLElement): void {
  // The empty previous line holds a `br` only so it has a height; joining onto it means
  // dropping the placeholder, not putting the text after a line break.
  if (previous.childNodes.length === 1 && previous.firstChild?.nodeName === "BR") {
    previous.removeChild(previous.firstChild);
  }
  const moved = line.firstChild;
  while (line.firstChild) previous.appendChild(line.firstChild);
  line.remove();
  if (moved?.parentNode === previous) {
    const range = document.createRange();
    range.setStartBefore(moved);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  } else {
    placeCaretAtEndOfLine(previous);
  }
}

/** Put the caret after everything, so opening the editor does not destroy text. */
export function placeCaretAtEnd(element: HTMLElement): void {
  // The last top-level `div` is the last line: a caret at the root's own end would type
  // a text node beside the lines, not into one.
  const divs = lineElements(element);
  const line = divs[divs.length - 1] ?? element;
  placeCaretAtEndOfLine(line);
}

/** The caret at the end of one line, before the `br` that keeps an empty line open. */
export function placeCaretAtEndOfLine(line: HTMLElement): void {
  const range = document.createRange();
  const last = line.lastChild;
  if (last && last.nodeName === "BR") {
    range.setStartBefore(last);
    range.collapse(true);
  } else {
    range.selectNodeContents(line);
    range.collapse(false);
  }
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

/** Point the selection at the start of one line. */
export function placeCaretAtStart(line: HTMLElement): void {
  const range = document.createRange();
  range.selectNodeContents(line);
  range.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}
