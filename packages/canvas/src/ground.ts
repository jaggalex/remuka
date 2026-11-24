import { CARD_WHITE, FRAME_BODY_ALPHA, groundOf, stickyFill, type Widget } from "@remo/model";
import type { CanvasPalette } from "./palette";

/**
 * Which surface a widget's ink is computed from (ADR-273 §2.1).
 *
 * The colour itself is the model's `groundOf`; this file only knows the layout facts the
 * model does not: that a note's fill is `stickyFill`, that a frame's body is paper at 75 %,
 * that a card inside a matrix takes its column's fill. One resolver, so the screen, the
 * export and the DOM layers cannot disagree about what a thing lies on.
 */
export interface GroundOptions {
  /**
   * The fill the painter is using when the widget has no fill of its own: a card in a
   * kanban takes its column's, which only the matrix knows.
   */
  fill?: string;
  /** Resolves a parent, so a caption inside a frame knows it lies on the frame's body. */
  resolve?: (id: string) => Widget | undefined;
}

/** The surface under `widget`: its own fill, else its container's, else the canvas. */
export function groundOfWidget(
  widget: Widget,
  palette: CanvasPalette,
  options: GroundOptions = {},
): string {
  const canvas = palette.canvas;
  if (widget.type === "frame") {
    // A frame is a container: its body covers the canvas at 75 %, so it follows the theme.
    return groundOf({ container: palette.paper, containerAlpha: FRAME_BODY_ALPHA, canvas });
  }
  const fill = options.fill ?? ownFillOf(widget, palette);
  const parent =
    widget.parentId && options.resolve ? options.resolve(widget.parentId) : undefined;
  if (parent?.type === "frame") {
    return groundOf({
      fill,
      container: palette.paper,
      containerAlpha: FRAME_BODY_ALPHA,
      canvas,
    });
  }
  return groundOf({ fill, canvas });
}

/** The fill a kind paints itself, when it has one; a transparent shape has none. */
export function ownFillOf(widget: Widget, palette: CanvasPalette): string | undefined {
  switch (widget.type) {
    case "sticky_note":
      return stickyFill(widget.style?.fillColor);
    case "shape": {
      const fill = widget.style?.fillColor;
      // A shape with no stored fill still paints paper, so that paper is its ground; a
      // transparent one stands on whatever is under it.
      if (fill === "transparent") return undefined;
      return fill ?? palette.paper;
    }
    case "kanban":
      return widget.style?.fillColor ?? palette.kanbanGround;
    case "timer":
      return CARD_WHITE;
    case "image":
      return palette.paper;
    default:
      return widget.style?.fillColor;
  }
}

/** The surface of a kanban's own parts: its chosen colour or the board's default paper. */
export function kanbanGroundOf(widget: Widget, palette: CanvasPalette): string {
  return widget.style?.fillColor ?? palette.kanbanGround;
}

/** A connector's label is a paper chip on the line; its text lies on that paper. */
export function connectorLabelGround(palette: CanvasPalette): string {
  return palette.paper;
}
