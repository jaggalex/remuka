import type { Widget } from "./types";

/**
 * Two-sided sticky notes (ADR-320).
 *
 * The frame's confirmed side is board state, not a widget field: one `meta` key per
 * shown frame. The back text is a second `Y.Text` under `${id}#back`; a widget only
 * carries the materialised copy for painting.
 */

/** `meta` key prefix for a frame whose answers are shown. */
export const ANSWERS_PREFIX = "answers:";

/** The `meta` key that records a frame's shown state. */
export function answersKey(frameId: string): string {
  return `${ANSWERS_PREFIX}${frameId}`;
}

/** The frame id in an `answers:` key, or null for any other `meta` key. */
export function frameIdOfAnswersKey(key: string): string | null {
  if (!key.startsWith(ANSWERS_PREFIX)) return null;
  const frameId = key.slice(ANSWERS_PREFIX.length);
  return frameId || null;
}

/** Suffix of the second `Y.Text` in `texts`; the front text keeps the bare id. */
export const BACK_TEXT_SUFFIX = "#back";

/** The `texts` key of a widget's back side. */
export function backTextKey(widgetId: string): string {
  return `${widgetId}${BACK_TEXT_SUFFIX}`;
}

/** The widget id behind a `texts` key, or null for a malformed key. */
export function widgetIdOfTextKey(key: string): string | null {
  if (!key.endsWith(BACK_TEXT_SUFFIX)) return key || null;
  const widgetId = key.slice(0, -BACK_TEXT_SUFFIX.length);
  return widgetId || null;
}

/** Which side a two-sided sticker currently draws. */
export type StickySide = "front" | "back";

/** The materialised back text makes a sticker two-sided; whitespace does not. */
export function hasBackSide(widget: Pick<Widget, "type" | "backContent">): boolean {
  return (
    widget.type === "sticky_note" &&
    typeof widget.backContent === "string" &&
    widget.backContent.trim().length > 0
  );
}

/**
 * The side a sticker draws (ADR-320 §3).
 *
 * Only a two-sided `sticky_note` whose direct `parentId` names a shown frame draws the
 * back. A table `cell` adds no parent; a nested frame has its own key.
 */
export function sideOf(
  widget: Pick<Widget, "type" | "parentId">,
  hasBack: boolean,
  answered: ReadonlySet<string>,
): StickySide {
  if (widget.type !== "sticky_note" || !hasBack || !widget.parentId) return "front";
  return answered.has(widget.parentId) ? "back" : "front";
}
