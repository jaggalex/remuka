/**
 * The paint a new shape starts with (ADR-267, `spec/canvas-character.md` §2).
 *
 * A shape is a diagram node on warm paper, not a white rectangle: the fill is the
 * landing page's `paper-cream-25`, and the outline is ink at 2 px. These are document
 * values, not tokens — a shared document cannot read a stylesheet (ADR-127) — so the
 * model carries the hex and `shapeFill.test.ts` compares it with `tokens.json`.
 */
export const SHAPE_PAPER = "#fffdf8";

/** The ink a shape's outline and text fall back to (ADR-267). */
export const SHAPE_INK = "#1e2136";
