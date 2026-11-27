import {
  CARD_RADIUS,
  DEFAULT_PALETTE,
  groundOfWidget,
  noteFontSizeFor,
  notePadding,
  textCapFor,
  textFloorFor,
  type Camera,
  type CanvasPalette,
  type KanbanLayout,
} from "@remo/canvas";
import {
  CARD_WHITE,
  cardFillFor,
  inkFor,
  kindOf,
  rotationOf,
  stickyFill,
  type TextDeltaOp,
  type TextRun,
  type Widget,
} from "@remo/model";
import type { EditorTarget } from "./InlineEditor";
import { connectorEditorTarget } from "./connectorEditor";
import { placementOfCard } from "./canvasGeometry";
import type { BoardSettings } from "./settings";
import { DEFAULT_FILL } from "./objectDefaults";

/**
 * Where the inline editor sits and how it looks (ADR-038).
 *
 * The editor must cover the painted text exactly: same box, same font size, same
 * padding and the same fill, or the caret sits at a different scale from the letters
 * around it. Kept out of the canvas component so the geometry has one home.
 */
/** The accent of the column a card is in, for the fill the matrix paints it with. */
function columnAccent(layouts: Map<string, KanbanLayout>, cardId: string): string | undefined {
  for (const layout of layouts.values()) {
    const placement = layout.placements.find((entry) => entry.cardId === cardId);
    if (!placement) continue;
    return layout.columns.find((column) => column.id === placement.columnId)?.accent;
  }
  return undefined;
}

export function editorTargetFor({
  editingId,
  widgets,
  layouts,
  camera,
  settings,
  deltaOf,
  widgetById,
  rect,
  palette,
}: {
  editingId: string | null;
  widgets: Widget[];
  layouts: Map<string, KanbanLayout>;
  camera: Camera;
  settings: BoardSettings;
  deltaOf: (id: string) => TextDeltaOp[];
  widgetById: (id: string) => Widget | undefined;
  rect: DOMRect;
  /** The canvas palette, so the editor opens in the ink the painter would use. */
  palette?: CanvasPalette;
}): EditorTarget | null {
  if (!editingId) return null;
  const widget = widgets.find((entry) => entry.id === editingId);
  if (!widget) return null;

  const toScreen = (x: number, y: number) => ({
    left: (x - camera.x) * camera.zoom + rect.width / 2,
    top: (y - camera.y) * camera.zoom + rect.height / 2,
  });

  if (widget.type === "connector") {
    return connectorEditorTarget(
      widget,
      camera,
      rect,
      deltaOf(widget.id),
      widgetById,
      {
        max: settings.connectors.stubMax,
        ratio: settings.connectors.stubRatio,
      },
      settings.text.fontFamily,
    );
  }

  // A card's box comes from the kanban matrix, everything else from the widget.
  const cardPlacement = placementOfCard(layouts, editingId);
  const width = cardPlacement?.width ?? widget.width;
  const height = cardPlacement?.height ?? widget.height;
  const centerX = cardPlacement?.x ?? widget.x;
  const centerY = cardPlacement?.y ?? widget.y;
  const topLeft = toScreen(centerX - width / 2, centerY - height / 2);

  const isCard = widget.type === "card";
  const delta = deltaOf(widget.id);
  const runs: TextRun[] = delta
    .filter((op) => op.insert)
    .map((op) => ({ text: op.insert!, ...op.attributes }));

  // The editor must use exactly the size the painter picked, or the caret sits at a
  // different scale from the letters around it.
  const textSize = isCard
    ? 15
    : (noteFontSizeFor(
        runs,
        width,
        height,
        textCapFor(widget, settings.notes.fontCap),
        widget.style?.fontSize,
        textFloorFor(widget),
        settings.text.fontFamily,
        // A heading or a marker makes the block taller: the editor has to open at the
        // size the painter chose for that block, or its caret sits at another scale.
        widget.lines,
      ) ?? 16);

  // The note's own fill and the ink that goes with it, so the editor shows the
  // colours the text will really have (ADR-038). A card takes its column's fill, the
  // same derived value the matrix paints (ADR-267 §2.1).
  const cardFill =
    widget.type === "card"
      ? widget.style?.fillColor ?? cardFillFor(columnAccent(layouts, widget.id))
      : CARD_WHITE;
  const fill =
    widget.type === "sticky_note"
      ? stickyFill(widget.style?.fillColor)
      : widget.type === "shape"
        ? (widget.style?.fillColor ?? DEFAULT_FILL)
        : widget.type === "text"
          ? "transparent"
          : cardFill;
  // Text has no fill of its own: it lies on the canvas or on the frame body it is in. A
  // card lies on the fill the matrix derived, not on its empty stored style.
  const ground = groundOfWidget(widget, palette ?? DEFAULT_PALETTE, {
    fill: isCard ? cardFill : undefined,
    resolve: widgetById,
  });

  return {
    id: widget.id,
    rect: {
      left: topLeft.left,
      top: topLeft.top,
      width: width * camera.zoom,
      height: height * camera.zoom,
    },
    delta,
    // No screen-space floor: the editor must be the same size as the painted text,
    // even when the note is zoomed far out.
    fontSize: Math.max(0.5, textSize * camera.zoom),
    // World padding, scaled: the same gap the painter uses.
    padding: notePadding(textSize) * camera.zoom,
    align: isCard ? ("left" as const) : (widget.style?.textAlign ?? ("center" as const)),
    vAlign: isCard ? ("top" as const) : (widget.style?.textVAlign ?? ("middle" as const)),
    // A card is a title and a connector label is a single line: inline marks only.
    richBlocks: kindOf(widget.type).richBlocks,
    fontWeight: widget.style?.fontSize && widget.style.fontSize > 24 ? 700 : 400,
    fill,
    // The caret and the letters must be the painter's ink, never the theme's (ADR-273):
    // a black text on the dark canvas opens as a black editor with its halo colour.
    ink: inkFor(
      ground,
      widget.type === "text" ? widget.style?.color : widget.style?.textColor,
    ).color,
    // The editor takes the shape of what it edits: a card is a sheet with CARD_RADIUS (ADR-234).
    radius: isCard ? CARD_RADIUS : widget.type === "sticky_note" ? 3 : 2,
    // The editor covers the painted text, and a turned object's text is turned, so the
    // DOM layer takes the same angle about the same centre (ADR-271, T18).
    ...(rotationOf(widget) !== 0 ? { rotation: rotationOf(widget) } : {}),
  };
}
