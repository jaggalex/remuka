import type { LineFormat } from "@remo/model";

/**
 * The two halves of the format bar, talking without a shared React state (ADR-252 §6).
 *
 * The bar sits in `StickyPanel` and the editor is a separate `contentEditable`; the note
 * being edited is the only thing they both know. A DOM event on the editor carries what
 * the bar asked for, so neither component owns the other and the caret never leaves the
 * text when a button is pressed.
 */
export const LINE_BLOCK_EVENT = "remo:line-block";
export const INLINE_CODE_EVENT = "remo:inline-code";
export const CLEAR_FORMAT_EVENT = "remo:clear-formatting";
export const LINK_OPEN_EVENT = "remo:link-open";
/** A format changed inside the editor; the bar re-reads the caret's block. */
export const FORMAT_CHANGED_EVENT = "remo:format-changed";
/** A remo board fragment was pasted into an open note: paste objects, not text. */
export const PASTE_FRAGMENT_EVENT = "remo:paste-fragment";

export type LineBlock = NonNullable<LineFormat["block"]>;

/** What a bar button asks the editor to do to the lines under the selection. */
export function dispatchLineBlock(root: HTMLElement, block: LineBlock | null): void {
  root.dispatchEvent(new CustomEvent<LineBlock | null>(LINE_BLOCK_EVENT, { detail: block }));
}

/** The bar's inline-code button; the editor owns the DOM around the selection. */
export function dispatchInlineCode(root: HTMLElement): void {
  root.dispatchEvent(new Event(INLINE_CODE_EVENT));
}

/** The bar asks the editor to clear marks and formats in one commit. */
export function dispatchClearFormatting(root: HTMLElement): void {
  root.dispatchEvent(new Event(CLEAR_FORMAT_EVENT, { bubbles: true }));
}

/** ⌘K in the editor opens the bar's link window; the bar owns that window. */
export function dispatchLinkOpen(root: HTMLElement): void {
  root.dispatchEvent(new Event(LINK_OPEN_EVENT, { bubbles: true }));
}

/**
 * Tell the bar the caret's format may have changed.
 *
 * The bar's buttons mutate the same DOM the editor does; without this the pressed
 * state would wait for the next keystroke. It is one event for every format command,
 * not a second copy of the format state.
 */
export function dispatchFormatChanged(root: HTMLElement): void {
  root.dispatchEvent(new Event(FORMAT_CHANGED_EVENT, { bubbles: true }));
}

/**
 * The editor saw our own fragment on the clipboard (§5.4.2).
 *
 * The event bubbles out of the editor so the app — which owns the document and the
 * clipboard commands — can paste the objects beside the note; the editor is unmounted by
 * that handler and never inserts the JSON as text.
 */
export function dispatchPasteFragment(root: HTMLElement): void {
  root.dispatchEvent(new Event(PASTE_FRAGMENT_EVENT, { bubbles: true }));
}
