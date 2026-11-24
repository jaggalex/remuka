import type { Widget } from "@remo/model";
import { drawInkPlate, PLATE, plateFont, plateWidth } from "./inkPlate";
import type { CanvasPalette } from "./palette";

/** The dark plate above a kanban's left corner: the board's name and what it is (ADR-279). */
const KANBAN_PLATE_WEIGHT = 600;

/**
 * The kanban's title plate, like the mockup's "Sprint 15 · kanban".
 *
 * It sits above the board's top-left corner, overlapping its edge by the gap, so it never
 * covers a column title and stays inside the export's padding (24 board units). Without a
 * name of its own the board still says what it is; the word comes from the app.
 */
export function drawKanbanPlate(
  ctx: CanvasRenderingContext2D,
  widget: Widget,
  palette: CanvasPalette,
  fontFamily: string,
  typeName: string,
): void {
  const name = widget.title?.trim();
  const text = name ? `${name} · ${typeName}` : typeName;
  if (!text) return;

  ctx.save();
  ctx.font = plateFont(fontFamily, KANBAN_PLATE_WEIGHT);
  const width = plateWidth(ctx, text);
  ctx.restore();

  const left = widget.x - widget.width / 2;
  const top = widget.y - widget.height / 2 - PLATE.height + PLATE.gap;
  drawInkPlate(
    ctx,
    { x: left, y: top, width, height: PLATE.height },
    text,
    palette,
    { fontFamily, weight: KANBAN_PLATE_WEIGHT },
  );
}
