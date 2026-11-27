import { CARD_WHITE } from "@remo/model";
import { DEFAULT_PALETTE, type CanvasPalette } from "./palette";
import { roundRect } from "./path";

/** `radius-md`: a card is a sheet with soft corners, not a pill (DESIGN.md §8). */
export const CARD_RADIUS = 10;
/**
 * A card stands off its column on a hard ink shadow (ADR-267 §2.1): an offset silhouette
 * with no blur, in board units at zoom 1, like the shadow of the cardboard chrome.
 */
export const CARD_SHADOW = { offset: 3 } as const;
/** The card's outline, in world units: two, the mockup's ink edge (ADR-267). */
export const CARD_OUTLINE = 2;
/** The selection frame, in screen pixels, drawn outside the sheet. */
const SELECTION_WIDTH = 2;

/**
 * One card face for every path that paints a card: the kanban matrix and the `card`
 * widget (ADR-234, ADR-267).
 *
 * The sheet is filled with its column's colour — or the card's own, when someone chose
 * one — outlined in ink and lifted by a hard shadow. The fill is a value, not a token:
 * the palette is the document's, and the export must paint what the screen paints. The
 * only frame a card ever gets in addition is the selection, drawn outside the sheet so
 * it does not eat into the content.
 */
export function drawCardSheet(
  ctx: CanvasRenderingContext2D,
  box: { x: number; y: number; width: number; height: number },
  zoom: number,
  options: {
    palette?: CanvasPalette;
    selected?: boolean;
    /** The sheet's fill; white paper when the caller has no column to read. */
    fill?: string;
  } = {},
): void {
  const palette = options.palette ?? DEFAULT_PALETTE;
  const fill = options.fill ?? CARD_WHITE;
  const ink = palette.objectInk;
  const { x, y, width, height } = box;

  ctx.save();
  // The hard shadow is the same silhouette, moved down and right: no blur, so it reads
  // as a second sheet of ink rather than as a glow.
  ctx.fillStyle = ink;
  roundRect(ctx, x + CARD_SHADOW.offset, y + CARD_SHADOW.offset, width, height, CARD_RADIUS);
  ctx.fill();

  ctx.fillStyle = fill;
  roundRect(ctx, x, y, width, height, CARD_RADIUS);
  ctx.fill();

  ctx.strokeStyle = ink;
  ctx.lineWidth = CARD_OUTLINE / zoom;
  roundRect(ctx, x, y, width, height, CARD_RADIUS);
  ctx.stroke();
  ctx.restore();

  if (options.selected) {
    const lineWidth = SELECTION_WIDTH / zoom;
    const out = lineWidth / 2;
    ctx.save();
    ctx.strokeStyle = palette.selectionStroke;
    ctx.lineWidth = lineWidth;
    roundRect(ctx, x - out, y - out, width + out * 2, height + out * 2, CARD_RADIUS + out);
    ctx.stroke();
    ctx.restore();
  }
}
