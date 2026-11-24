import { localPointOf, rotationOf, type Rect, type Widget } from "@remo/model";
import { drawInkPlate, PLATE, plateFont, plateWidth } from "./inkPlate";
import type { CanvasPalette } from "./palette";

/**
 * The frame's label (ADR-267 §2): an ink plate over its top-left corner.
 *
 * The plate is content — a frame's name must be in a PNG and a PDF, not only in the DOM —
 * so the board painter draws it. It is also the frame's handle: the gesture machine asks
 * `frameLabelAt` before it picks objects, so a press on the plate selects and moves the
 * frame exactly as a press on its body does. The accessible control over the same
 * rectangle is `SectionTitleLayer`, which stays the only "Rename section".
 */
export const FRAME_LABEL = PLATE;

/** The label text: the frame's own name, or nothing (an unnamed frame has no plate). */
export function frameLabelText(widget: Widget): string {
  return widget.type === "frame" ? (widget.title?.trim() ?? "") : "";
}

/** The plate's box for a measured width, in board units. */
export function frameLabelRect(widget: Widget, width: number): Rect {
  return {
    x: widget.x - widget.width / 2,
    y: widget.y - widget.height / 2 - FRAME_LABEL.height + FRAME_LABEL.gap,
    width,
    height: FRAME_LABEL.height,
  };
}

export function frameLabelWidth(
  measure: { measureText(text: string): { width: number } },
  text: string,
): number {
  return plateWidth(measure, text);
}

export function frameLabelFont(fontFamily: string): string {
  return plateFont(fontFamily);
}

/**
 * The frame whose label plate covers `point`, or null.
 *
 * Topmost wins, like `pick`: frames are painted back to front, so the last match is the
 * one a person sees. The plate overlaps the frame's edge by `PLATE.gap`, which is the
 * part that reads as attached to the box.
 */
export function frameLabelAt(
  widgets: readonly Widget[],
  point: { x: number; y: number },
  measure: { measureText(text: string): { width: number } },
): Widget | null {
  for (let index = widgets.length - 1; index >= 0; index -= 1) {
    const widget = widgets[index]!;
    const text = frameLabelText(widget);
    if (!text) continue;
    // The plate is painted turned with its frame, so it is tested in the frame's axes
    // (ADR-271, T18).
    const turned = rotationOf(widget) !== 0;
    const local = turned ? localPointOf(widget, point) : point;
    const rect = turned
      ? frameLabelRect({ ...widget, x: 0, y: 0, rotation: 0 }, frameLabelWidth(measure, text))
      : frameLabelRect(widget, frameLabelWidth(measure, text));
    if (
      local.x >= rect.x &&
      local.x <= rect.x + rect.width &&
      local.y >= rect.y &&
      local.y <= rect.y + rect.height
    ) {
      return widget;
    }
  }
  return null;
}

/** Paint the frame's label; called by the frame's own painter, so it appears in exports. */
export function drawFrameLabel(
  ctx: CanvasRenderingContext2D,
  widget: Widget,
  palette: CanvasPalette,
  fontFamily: string,
): void {
  const text = frameLabelText(widget);
  if (!text) return;
  ctx.save();
  ctx.font = frameLabelFont(fontFamily);
  const width = frameLabelWidth(ctx, text);
  ctx.restore();
  drawInkPlate(ctx, frameLabelRect(widget, width), text, palette, {
    fontFamily,
    square: "bottom-left",
  });
}
