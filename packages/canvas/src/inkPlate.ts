import type { CanvasPalette } from "./palette";

/**
 * The ink plate above an object: a kanban's name (ADR-279) and a frame's label (T3).
 *
 * One painter for both, so the two plates cannot drift in height, padding, corner or
 * the white text on them. The plate is content: it is painted for the screen and the
 * export by the same code, and it never reads a theme colour.
 */
export const PLATE = { height: 24, pad: 10, gap: 2, radius: 8, font: 13, weight: 700 } as const;

export type SquareCorner = "none" | "bottom-left";

export interface PlateBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A rounded rectangle whose bottom-left corner may be square, as the frame label is. */
function platePath(
  ctx: CanvasRenderingContext2D,
  box: PlateBox,
  radius: number,
  square: SquareCorner,
): void {
  const { x, y, width, height } = box;
  const r = Math.min(radius, width / 2, height / 2);
  const left = square === "bottom-left" ? 0 : r;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.arcTo(x + width, y, x + width, y + r, r);
  ctx.lineTo(x + width, y + height - r);
  ctx.arcTo(x + width, y + height, x + width - r, y + height, r);
  ctx.lineTo(x + left, y + height);
  if (left === 0) {
    ctx.lineTo(x, y + height);
  } else {
    ctx.arcTo(x, y + height, x, y + height - r, r);
  }
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

/** Width of a plate for `text`, padding included; the caller measures in its own font. */
export function plateWidth(measure: { measureText(text: string): { width: number } }, text: string): number {
  return measure.measureText(text).width + PLATE.pad * 2;
}

export function plateFont(fontFamily: string, weight: number = PLATE.weight): string {
  return `${weight} ${PLATE.font}px ${fontFamily}`;
}

/** Paint one plate with `text` at `box`; the text is set by the caller's font. */
export function drawInkPlate(
  ctx: CanvasRenderingContext2D,
  box: PlateBox,
  text: string,
  palette: CanvasPalette,
  options: { fontFamily: string; square?: SquareCorner; weight?: number } = { fontFamily: "sans-serif" },
): void {
  if (!text) return;
  ctx.save();
  ctx.font = plateFont(options.fontFamily, options.weight);
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  platePath(ctx, box, PLATE.radius, options.square ?? "none");
  ctx.fillStyle = palette.objectInk;
  ctx.fill();
  ctx.fillStyle = palette.objectPaper;
  ctx.fillText(text, box.x + PLATE.pad, box.y + box.height / 2 + 0.5);
  ctx.restore();
}
