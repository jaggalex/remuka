import { type Elevation, elevationOf, type Widget } from "@remo/model";
import type { CanvasPalette } from "./palette";
import { deviceScale } from "./path";

/**
 * Shadow geometry of each level, in board units at zoom 1 (ADR-245, ADR-267). The colours
 * are tokens (`canvas-raise-cast`, `canvas-float-cast`, the object ink); only the shape
 * of the shadow lives here, and it follows the zoom like a note's paper shadow.
 *
 * "Cardboard" is the hard one: the same silhouette moved down and right by six units,
 * with no blur, so it reads as a second sheet of ink — the way a card stands off its
 * column (ADR-267 §2.1) and the chrome stands off the page (ADR-265).
 */
export const ELEVATION_SHADOW: Record<
  Elevation,
  { dx: number; offset: number; blur: number }
> = {
  raised: { dx: 0, offset: 2, blur: 8 },
  cardboard: { dx: 6, offset: 6, blur: 0 },
  floating: { dx: 0, offset: 10, blur: 28 },
};

/**
 * The level a palette actually paints.
 *
 * Content is not recoloured by the theme, and a hard ink shadow cannot be seen on the
 * dark board: until the dark theme gets its own cardboard (ADR-265, stage 6), the level
 * is drawn exactly as "floating" there. The stored level is untouched, so switching the
 * theme back restores the hard shadow.
 */
export function paintedElevation(level: Elevation, theme: CanvasPalette["theme"]): Elevation {
  return level === "cardboard" && theme === "dark" ? "floating" : level;
}

/**
 * Cast the shadow of a raised kanban, frame or shape, and nothing else.
 *
 * `trace` builds the object's outline as a fresh path (it may call `beginPath`). The cast is
 * clipped to everything *outside* that outline: a frame's fill is translucent, and a
 * shadow under it would darken its inside. Call it before the object's own fill.
 */
export function castElevation(
  ctx: CanvasRenderingContext2D,
  widget: Pick<Widget, "type" | "style" | "x" | "y" | "width" | "height">,
  zoom: number,
  palette: CanvasPalette,
  trace: () => void,
): void {
  const stored = elevationOf(widget);
  if (!stored) return;
  const level = paintedElevation(stored, palette.theme);
  const { dx, offset, blur } = ELEVATION_SHADOW[level];
  // Far enough out that no part of the blur is cut by the clip's outer edge.
  const reach = Math.max(offset, dx) + blur * 2 + 1;
  const left = widget.x - widget.width / 2 - reach;
  const top = widget.y - widget.height / 2 - reach;
  const scale = deviceScale(ctx, zoom);

  ctx.save();
  trace();
  ctx.rect(left, top, widget.width + reach * 2, widget.height + reach * 2);
  ctx.clip("evenodd");
  ctx.shadowColor =
    level === "cardboard" ? palette.objectInk : level === "floating" ? palette.floatCast : palette.raiseCast;
  ctx.shadowBlur = blur * scale;
  ctx.shadowOffsetX = dx * scale;
  ctx.shadowOffsetY = offset * scale;
  // Opaque, because a shadow's strength is its colour times the fill's alpha. The fill
  // itself lies inside the outline and is clipped away; only its shadow remains, and its
  // colour is the level's own above — so this is any opaque paint, not a content colour.
  ctx.fillStyle = palette.objectInk;
  trace();
  ctx.fill();
  ctx.restore();
}
