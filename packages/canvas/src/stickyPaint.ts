import { ink as inkOn, inkFor, shade, stickyFill, type Widget } from "@remo/model";
import { drawClipMark } from "./clipMark";
import { deviceScale, roundRect } from "./path";
import type { CanvasPalette } from "./palette";
import { STICKER_HOVER, stickerShadow } from "./stickerMotion";
import { drawTextInBox } from "./textPaint";
import { textCapFor } from "./textLayout";

/**
 * A sticky note: the paper sheet of ADR-181, the hand of ADR-265 and the ink of ADR-273.
 *
 * Lifted out of the widget switch so `render.ts` stays inside its line budget; the
 * painter is the same code, and the note still owns its tilt, its cast shadow and its
 * text block.
 */

/** The sticky sheet in world units: radius, and the shadow under the bottom edge. */
export const STICKY_RADIUS = 2;
export const STICKY_SHADOW = { offset: 12, blur: 14, inset: 6, dx: 2 } as const;
/** How much lighter the upper-left corner is and how much darker the lower-right one. */
export const STICKY_SHEEN = { light: 0.3, dark: -0.03 } as const;

/** The six tilts a sticky note can have, in degrees (ADR-265 §3.2; same set as the mockups). */
export const STICKY_TILTS = [-1.6, 1.2, -0.6, 1.8, -1.1, 0.7] as const;

/** A note's own tilt: a stable hash of its id picks one of STICKY_TILTS. */
export function stickyTilt(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return STICKY_TILTS[(hash >>> 0) % STICKY_TILTS.length]!;
}

export interface StickyPaint {
  palette: CanvasPalette;
  fontFamily: string;
  fontCap: { S: number; M: number; L: number };
  /** How much the sheet is in hand, 0…1 (ADR-265 §4.2). */
  hand: number;
  /** Paint paper square: no tilt, e.g. for a card in a column. */
  straight: boolean;
  editing: boolean;
  shadowBoost: boolean;
}

export function paintSticky(
  ctx: CanvasRenderingContext2D,
  widget: Widget,
  zoom: number,
  paint: StickyPaint,
): void {
  const { palette } = paint;
  const left = widget.x - widget.width / 2;
  const top = widget.y - widget.height / 2;
  const fill = stickyFill(widget.style?.fillColor);
  // Paper is never laid perfectly straight (ADR-265 §3.2): each note keeps a small tilt
  // of its own, derived from its id, so every participant and every reload sees the same
  // one. A note being selected or edited straightens up: handles and the editor are square.
  //
  // Under the hand (§4.2) the sheet lifts, grows a little and straightens; released, a
  // spring drops it back to its own tilt with one small settle. `hand` is 0 at rest and
  // can go slightly below zero as the paper presses in.
  const hand = paint.hand;
  const tilt =
    paint.editing || paint.straight ? 0 : stickyTilt(widget.id) * (1 - hand);
  ctx.save();
  ctx.translate(widget.x, widget.y + (STICKER_HOVER.lift * hand) / zoom);
  const grown = 1 + STICKER_HOVER.scale * hand;
  ctx.scale(grown, grown);
  if (tilt) ctx.rotate((tilt * Math.PI) / 180);
  ctx.translate(-widget.x, -widget.y);
  // A paper sheet (ADR-181): the shadow sits only under the bottom edge. Canvas has no
  // shadow spread, so a narrower sheet hidden behind the note casts it; the shadow is in
  // device pixels, so it is scaled with the note to stay the same paper at any zoom.
  const scale = deviceScale(ctx, zoom) * stickerShadow(hand, paint.shadowBoost);
  const inset = Math.min(STICKY_SHADOW.inset, widget.width / 4);
  ctx.save();
  ctx.shadowColor = palette.stickerCast;
  ctx.shadowBlur = STICKY_SHADOW.blur * scale;
  ctx.shadowOffsetX = STICKY_SHADOW.dx * scale;
  ctx.shadowOffsetY = STICKY_SHADOW.offset * scale;
  ctx.fillStyle = fill;
  ctx.fillRect(left + inset, top + widget.height / 2, widget.width - inset * 2, widget.height / 2);
  ctx.restore();

  // The sheet itself, lighter where the light falls (upper left) than at the far corner.
  const sheen = ctx.createLinearGradient(left, top, left + widget.width, top + widget.height);
  if (sheen) {
    sheen.addColorStop(0, shade(fill, STICKY_SHEEN.light));
    sheen.addColorStop(1, shade(fill, STICKY_SHEEN.dark));
  }
  ctx.fillStyle = sheen ?? fill;
  roundRect(ctx, left, top, widget.width, widget.height, STICKY_RADIUS);
  ctx.fill();

  // A note has an edge: without one a pale note on the board's pale background is
  // a rectangle you have to guess at (ADR-030). The edge is derived ink on the sheet's
  // own fill (ADR-273), so it reads on every colour in both themes.
  ctx.strokeStyle = inkOn(fill, "line");
  ctx.lineWidth = 1 / zoom;
  roundRect(
    ctx,
    left + 0.5 / zoom,
    top + 0.5 / zoom,
    widget.width - 1 / zoom,
    widget.height - 1 / zoom,
    STICKY_RADIUS,
  );
  ctx.stroke();

  // The text colour follows the fill unless a person chose one: a deep note with dark
  // text is a note whose content nobody can read (ADR-038, ADR-273 §2.3).
  const ink = inkFor(fill, widget.style?.textColor);
  ctx.fillStyle = ink.color;

  // Notes and shapes share one text block: same Auto sizing, same alignment,
  // same runs. Two implementations would drift (ADR-033).
  if (!paint.editing) {
    const clipped = drawTextInBox(
      ctx,
      widget,
      { x: left, y: top, width: widget.width, height: widget.height },
      paint.fontFamily,
      {
        cap: textCapFor(widget, paint.fontCap),
        align: widget.style?.textAlign ?? "center",
        vAlign: widget.style?.textVAlign ?? "middle",
        clip: true,
        palette,
        ground: fill,
        halo: ink.halo,
        haloWidth: 1.5 / zoom,
      },
    );
    if (clipped) {
      drawClipMark(ctx, { x: left, y: top, width: widget.width, height: widget.height }, zoom, palette);
    }
  }
  ctx.restore();
}
