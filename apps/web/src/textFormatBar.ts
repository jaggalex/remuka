import { safeExternalUrl, type LineFormat, type TextLine } from "@remo/model";
import {
  lineElementAt,
  lineElements,
  lineFormatOf,
} from "./textLineDom";

/**
 * The format bar's view of the text (ADR-252 §6, §9).
 *
 * Outside the editor the bar reads the object's materialized `lines`; inside it the only
 * truth is the `contentEditable` DOM — the caret is the browser's and the document is
 * updated a moment later by the editor's own commit. Keeping both readings here means the
 * bar, the shortcuts and the editor agree on what "the current format" is.
 */

export type BarBlock = NonNullable<LineFormat["block"]>;

export const BAR_BLOCKS: readonly BarBlock[] = ["h1", "h2", "bullet", "ordered", "check"];

export function isListBlock(block: LineFormat["block"] | undefined): boolean {
  return block === "bullet" || block === "ordered" || block === "check";
}

/**
 * The block every given line shares, or null.
 *
 * This is the answer for both readers: outside editing the lines are the object's, and
 * inside it they are the lines the selection touches. A plain line, an empty list of
 * lines or two different blocks all mean "nothing is pressed".
 */
export function commonBlock(
  lines: ReadonlyArray<{ block?: LineFormat["block"] | null }> | null | undefined,
): BarBlock | null {
  if (!lines?.length) return null;
  const first = lines[0]!.block;
  if (!first) return null;
  return lines.every((line) => line.block === first) ? first : null;
}

/** Every distinct link address in the object's text, in reading order. */
export function linksOf(lines: ReadonlyArray<TextLine> | null | undefined): string[] {
  const seen: string[] = [];
  for (const line of lines ?? []) {
    for (const run of line.runs) {
      if (run.href && !seen.includes(run.href)) seen.push(run.href);
    }
  }
  return seen;
}

export type HrefCheck =
  | { href: string; error?: never }
  | { href?: never; error: "empty" | "scheme" | "address" };

/**
 * What the link window accepts (ADR-252 §1, rule 5).
 *
 * A full address must pass the model's own scheme gate, so the window and
 * `canonicalAttributes` cannot disagree about what is allowed. A bare domain gets
 * `https://`, a bare e-mail gets `mailto:` — the two things people type when they do not
 * want to think about schemes.
 */
export function normalizeHref(raw: string): HrefCheck {
  const value = raw.trim();
  if (!value) return { error: "empty" };
  if (/[\s\u0000-\u001f]/.test(value)) return { error: "scheme" };

  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(value)?.[1]?.toLowerCase();
  if (scheme) {
    const href = safeExternalUrl(value);
    if (href) return { href };
    return { error: scheme === "http" || scheme === "https" || scheme === "mailto" ? "address" : "scheme" };
  }

  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
    const href = safeExternalUrl(`mailto:${value}`);
    if (href) return { href };
  }
  const href = safeExternalUrl(`https://${value}`);
  return href ? { href } : { error: "address" };
}

/** The inline-editor element on the board, when one is open. */
export function editorRoot(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".inline-editor");
}

export interface EditorFormat {
  block: BarBlock | null;
  href: string | null;
  code: boolean;
}

/** The block and the link under the editor's selection. */
export function editorFormat(root: HTMLElement | null = editorRoot()): EditorFormat {
  const empty: EditorFormat = { block: null, href: null, code: false };
  if (!root) return empty;
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) return empty;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return empty;

  const all = lineElements(root);
  const touched = range.collapsed
    ? [lineElementAt(root, range.startContainer)].filter((line): line is HTMLElement => Boolean(line))
    : all.filter((line) => range.intersectsNode(line));

  return {
    block: commonBlock(touched.map((line) => lineFormatOf(line) ?? {})),
    href: linkAtNode(range.startContainer, root)?.getAttribute("href") ?? null,
    code: Boolean(codeAtNode(range.startContainer, root)),
  };
}

/** The nearest anchor around a node, inside the editor. */
export function linkAtNode(node: Node | null, root: HTMLElement): HTMLAnchorElement | null {
  let current: Node | null = node;
  while (current && current !== root) {
    if (current.nodeType === Node.ELEMENT_NODE) {
      const element = current as HTMLElement;
      if (element.tagName === "A") return element as HTMLAnchorElement;
    }
    current = current.parentNode;
  }
  return null;
}

/** The nearest `<code>` around a node, inside the editor. */
export function codeAtNode(node: Node | null, root: HTMLElement): HTMLElement | null {
  let current: Node | null = node;
  while (current && current !== root) {
    if (current.nodeType === Node.ELEMENT_NODE) {
      const element = current as HTMLElement;
      if (element.tagName === "CODE") return element;
    }
    current = current.parentNode;
  }
  return null;
}

export interface SavedSelection {
  root: HTMLElement;
  range: Range;
}

/**
 * Remember the selection before a window takes focus.
 *
 * Clicking into the link field blurs the editor; the DOM range itself usually survives
 * the blur, but not always, and re-applying to the wrong range would move the person's
 * caret. The window therefore works on a copy.
 */
export function saveEditorSelection(root: HTMLElement | null = editorRoot()): SavedSelection | null {
  if (!root) return null;
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;
  return { root, range: range.cloneRange() };
}

export function restoreEditorSelection(saved: SavedSelection): boolean {
  const { root, range } = saved;
  if (!root.isConnected || !root.contains(range.commonAncestorContainer)) return false;
  root.focus();
  const selection = window.getSelection();
  if (!selection) return false;
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

/** Move an element's children where it stood and remove it. */
function unwrapElement(element: HTMLElement): void {
  const parent = element.parentNode;
  if (!parent) return;
  while (element.firstChild) parent.insertBefore(element.firstChild, element);
  element.remove();
}

/**
 * Apply or remove a link around the saved selection.
 *
 * A caret inside a link edits or removes that whole link: `createLink` and `unlink`
 * work on a range, and a collapsed range is not one the browser acts on. A real
 * selection still goes through the browser's commands, which know how to split an
 * anchor when only part of it was selected.
 */
export function applyEditorHref(saved: SavedSelection, href: string | null): boolean {
  if (!restoreEditorSelection(saved)) return false;
  const selection = window.getSelection();
  const range = selection && selection.rangeCount ? selection.getRangeAt(0) : null;
  const existing = range ? linkAtNode(range.startContainer, saved.root) : null;

  if (range?.collapsed && existing) {
    if (href) existing.setAttribute("href", href);
    else unwrapElement(existing);
    saved.root.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }

  try {
    document.execCommand(href ? "createLink" : "unlink", false, href ?? undefined);
  } catch {
    return false;
  }
  saved.root.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}

/** Wrap or unwrap the selection in `<code>` for ⌘E. */
export function toggleEditorCode(root: HTMLElement): boolean {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) return false;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return false;

  const existing = codeAtNode(range.commonAncestorContainer, root);
  if (existing) {
    const parent = existing.parentNode;
    if (!parent) return false;
    while (existing.firstChild) parent.insertBefore(existing.firstChild, existing);
    existing.remove();
    return true;
  }
  if (range.collapsed) return false;
  const code = document.createElement("code");
  code.appendChild(range.extractContents());
  range.insertNode(code);
  selection.removeAllRanges();
  const after = document.createRange();
  after.selectNodeContents(code);
  selection.addRange(after);
  return true;
}
