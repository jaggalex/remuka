/**
 * Paper physics (ADR-265 §4.2, `spec/character.md`).
 *
 * A note is a sheet on a table. Under the pointer it lifts a little, straightens and its
 * shadow grows; carried, the shadow doubles; released, it drops back to its own tilt on a
 * spring (k = 300, c = 22) with one small settle, the way paper does. All of it is a
 * function of elapsed time, so a frame can be skipped without the note jumping: the
 * painter asks "how much is this sheet in hand now" and gets the same answer as the
 * previous frame would have given.
 *
 * Pure: no canvas, no clock. `apps/web/src/objectHand.ts` owns the clock.
 */

/** Hover: 220 ms on `cubic-bezier(.34, 1.56, .64, 1)`; the numbers are the mockups'. */
export const STICKER_HOVER = { ms: 220, lift: -3, scale: 0.03, shadow: 0.3 } as const;
/** Release: the owner's spring, just under critical damping (2·√300 ≈ 34.6). */
export const STICKER_SETTLE = { stiffness: 300, damping: 22, ms: 600 } as const;
/** How much taller a shadow grows when the sheet is fully in hand. */
export const STICKER_DRAG_SHADOW = 1.3;

const HOVER_BEZIER = [0.34, 1.56, 0.64, 1] as const;

/** One axis of a cubic Bézier with fixed endpoints 0 and 1. */
export function cubicBezier(t: number, p1: number, p2: number): number {
  const u = 1 - t;
  return 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t;
}

/**
 * Progress of the hover at `ageMs`, 0…1 (it overshoots 1 in the middle: the sheet
 * bounces up, not eases up). Solved on x because the curve is a function of time.
 */
export function hoverHand(ageMs: number): number {
  const t = Math.min(1, Math.max(0, ageMs / STICKER_HOVER.ms));
  if (t === 0 || t === 1) return t;
  // Bisection on x: 20 steps leave the parameter well under a pixel of a 220 ms curve.
  let low = 0;
  let high = 1;
  for (let i = 0; i < 20; i += 1) {
    const mid = (low + high) / 2;
    if (cubicBezier(mid, HOVER_BEZIER[0], HOVER_BEZIER[2]) < t) low = mid;
    else high = mid;
  }
  return cubicBezier((low + high) / 2, HOVER_BEZIER[1], HOVER_BEZIER[3]);
}

/**
 * How much the sheet is still "in hand" `ageMs` after release: 1 at the drop, then a
 * damped spring to 0. It goes slightly negative once, which the painter reads as the
 * sheet pressing into the table before it rests.
 */
export function settleHand(ageMs: number): number {
  if (ageMs <= 0) return 1;
  const { stiffness, damping } = STICKER_SETTLE;
  const omega = Math.sqrt(stiffness);
  const zeta = damping / (2 * omega);
  const damped = omega * Math.sqrt(Math.max(0, 1 - zeta * zeta));
  const decay = Math.exp(-zeta * omega * (ageMs / 1000));
  return decay * (Math.cos(damped * (ageMs / 1000)) + (zeta / Math.sqrt(Math.max(1e-6, 1 - zeta * zeta))) * Math.sin(damped * (ageMs / 1000)));
}

/** The shadow multiplier for a sheet that is `hand` in hand; dragging adds its own. */
export function stickerShadow(hand: number, dragging = false): number {
  const lift = 1 + STICKER_HOVER.shadow * Math.max(0, hand);
  return dragging ? lift * STICKER_DRAG_SHADOW : lift;
}
