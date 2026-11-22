import type { TextMarks } from "@remo/model";

/**
 * Numbers the painter, the fitter and the editor must agree on.
 *
 * These lived in `textLayout` until block layout arrived; the block module and the
 * inline module both need them, and importing each other would be a cycle. One small
 * home, imported by both, keeps a single answer for a line height or a padding.
 */

export const STICKY_FONT_PX = 16;
export const STICKY_LINE_HEIGHT = 20;
export const STICKY_PADDING = 12;
/** Room for the drop shadow and the last line's descenders. */
export const STICKY_BOTTOM_PADDING = 8;

/**
 * The typeface of text on the board: Golos Text, the design system's `font-sans` (ADR-181),
 * so a note reads in the same letters as the chrome around it. Inter stays second for a
 * browser that cannot load the woff2. The app passes the family chosen in settings.
 */
export const DEFAULT_FONT_FAMILY = '"Golos Text", Inter, "Helvetica Neue", Arial, sans-serif';

/**
 * The design system's `font-mono` (`type.families.mono` in `tokens.json`).
 *
 * Inline code needs it; canvas cannot read the token, so the stack is mirrored here the
 * same way the sans stack is.
 */
export const MONO_FONT_FAMILY = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

/** Stacks that were the default before; a stored copy of one is not a person's choice. */
export const PREVIOUS_FONT_FAMILIES: readonly string[] = [
  '"Helvetica Neue", Arial, sans-serif',
  'Inter, "Helvetica Neue", Arial, sans-serif',
];

/** Smallest text size Auto will shrink to before giving up. */
export const MIN_NOTE_FONT = 8;

/**
 * A shape's readable floor (ADR-214).
 *
 * A note may shrink its letters to 8 px because it is a physical object whose size is
 * the person's decision. A shape is a diagram node: below 10 px the label stops being
 * readable, so the shape grows instead.
 */
export const MIN_SHAPE_FONT = 10;

/** How tall a shape may grow for its text before the label is clipped (ADR-214). */
export const MAX_SHAPE_HEIGHT = 1280;

/**
 * How much smaller inline code is set than the surrounding text (`spec/rich-text.md` §7).
 *
 * The padding is horizontal room inside the code plate, one side.
 */
export const CODE_FONT_SCALE = 0.92;
export const CODE_PADDING_EM = 0.15;

/** Canvas font string for a mark set, so the painter and the metrics agree. */
export function fontFor(
  fontPx: number,
  marks?: TextMarks,
  family: string = DEFAULT_FONT_FAMILY,
  weight = 400,
): string {
  const parts: string[] = [];
  if (marks?.italic) parts.push("italic");
  // A weight below 600 is the browser default and would only make the string noisier;
  // headings ask for 600 explicitly (`spec/rich-text.md` §7).
  if (weight >= 600) parts.push(String(weight));
  else if (marks?.bold) parts.push("bold");
  const size = marks?.code ? fontPx * CODE_FONT_SCALE : fontPx;
  const face = marks?.code ? MONO_FONT_FAMILY : family;
  parts.push(`${roundSize(size)}px ${face}`);
  return parts.join(" ");
}

/** A font size with at most two decimals: a canvas font string stays readable in traces. */
function roundSize(size: number): number {
  return Math.round(size * 100) / 100;
}

/** Line box for a text size; the painter and the fitter must agree exactly. */
export function lineHeightFor(fontPx: number): number {
  return Math.round(fontPx * 1.25);
}

/** Space a note keeps between its text and its border. */
export function notePadding(fontPx: number): number {
  return Math.max(8, Math.round(fontPx * 0.75));
}

/**
 * The one clip question: do `count` lines of `lineHeight` fit the box inside `padding`?
 *
 * The painter asks it with the lines it has already laid out, the badge and the tester
 * ask it through `textClipped`; one formula means the mark, the word and the growth can
 * never disagree (ADR-214). The tolerance absorbs fractional line heights.
 */
export function linesClipped(
  count: number,
  lineHeight: number,
  height: number,
  padding: number,
): boolean {
  return count * lineHeight > Math.max(height - padding * 2, lineHeight) + 0.5;
}
