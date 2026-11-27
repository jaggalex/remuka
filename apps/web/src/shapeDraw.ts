import type { Rect } from "@remo/model";
import { resizedBox, type ResizeCorner } from "./canvasGeometry";

/**
 * The box a shape is drawn in with a pointer drag (ADR-271).
 *
 * The resize arithmetic is not repeated: a zero-sized box at the press is handed to
 * `resizedBox`, which already knows how to keep the opposite corner still and how to
 * grow around the centre. Shift is applied by moving the pointer onto the diagonal
 * first, so a square stays a square in both directions and Alt cannot break it.
 */
export function drawnShapeBox(
  start: { x: number; y: number },
  point: { x: number; y: number },
  modifiers: { square?: boolean; fromCenter?: boolean } = {},
): Rect {
  let end = point;
  if (modifiers.square) {
    const size = Math.max(Math.abs(point.x - start.x), Math.abs(point.y - start.y));
    end = {
      x: start.x + (point.x < start.x ? -size : size),
      y: start.y + (point.y < start.y ? -size : size),
    };
  }

  const origin: Rect = { x: start.x, y: start.y, width: 0, height: 0 };
  if (modifiers.fromCenter) {
    return resizedBox(origin, "se", end, 0, 0, { fromCenter: true });
  }

  const corner: ResizeCorner =
    point.y < start.y
      ? point.x < start.x
        ? "nw"
        : "ne"
      : point.x < start.x
        ? "sw"
        : "se";
  return resizedBox(origin, corner, end, 0, 0);
}

/**
 * Whether the pointer has travelled far enough to be a drawing gesture.
 *
 * Below four screen pixels it is a click, and a click creates the default shape at
 * the view's centre (ADR-119). Screen pixels, not board units: the rule must mean the
 * same thing at 25 % and at 200 % zoom.
 */
export const SHAPE_DRAG_THRESHOLD_PX = 4;

export function isShapeDrag(
  start: { x: number; y: number },
  at: { x: number; y: number },
): boolean {
  return Math.hypot(at.x - start.x, at.y - start.y) >= SHAPE_DRAG_THRESHOLD_PX;
}
