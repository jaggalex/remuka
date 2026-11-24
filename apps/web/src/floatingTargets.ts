import {
  boxOf,
  connectorPath,
  DEFAULT_PALETTE,
  groundOfWidget,
  labelMetrics,
  labelPoint,
  pathPolyline,
  unionBox,
  noteFontSizeFor,
  textCapFor,
  textFloorFor,
  type Camera,
} from "@remo/canvas";
import {
  inkFor,
  kindOf,
  routingOf,
  stickyFill,
  type ShapeKind,
  type StickySize,
  type TextMarks,
  type TextRun,
  type Widget,
} from "@remo/model";
import type { CanvasPalette } from "@remo/canvas";
import type { ArrangeBarTarget } from "./ArrangeBar";
import type { ConnectorBarTarget } from "./ConnectorBar";
import type { StickyBarTarget } from "./StickyBar";
import type { NoteDirection } from "@remo/doc";
import { GATHERABLE_TYPES } from "@remo/doc";
import type { BoardSettings } from "./settings";
import type { ImageBarTarget } from "./object-panel/ImagePanel";
import { COMPACT_BAR_ROOM, barTop } from "./canvasGeometry";
import { DEFAULT_FILL } from "./objectDefaults";

/**
 * Where the floating bars go, and what they show.
 *
 * The bars are properties of the selected object, but their coordinates are a function
 * of the camera, the viewport and the object's box — no component state. Extracting them
 * from `BoardCanvas.tsx` makes the placement testable and takes two hundred lines of
 * arithmetic out of the gesture file (ADR-055).
 */

/** The board's screen box plus the camera looking at it. */
export interface Frame {
  camera: Camera;
  viewport: { width: number; height: number };
}

/**
 * The note bar: one colour sample, the note sizes, text size, marks, block formats,
 * alignment, link and More. Measured at 1440 in English: 517 px before the format row,
 * plus 147 px for seven controls and a divider; half of the new width keeps the bar
 * centred instead of hanging off the right edge (ADR-127, ADR-252 §6).
 */
const NOTE_BAR_HALF = 332;
/**
 * The shape bar has no S/M/L row: sample, text size, marks, block formats, alignment,
 * link and More, measured at 1440: 426 + 147 px wide.
 */
const SHAPE_BAR_HALF = 450;
/** A free text bar is the same controls without the note sizes: 420 + 147 px wide. */
const TEXT_BAR_HALF = 284;
/** The arrange bar names the selection, shows the shared role, Align, grouping and More. */
/**
 * Arrange-bar widths: the toolbar grows with its content, and the placement must know
 * which one it is guessing. A shape-only selection carries the kind switch and the two
 * corner buttons; every other selection does not.
 */
const ARRANGE_BAR_WIDTH = 740;
const ARRANGE_BAR_WIDTH_SHAPES = 980;
/**
 * The connector bar: line type, one colour sample, the three end controls, the label and
 * More. Measured at 1440 with English words ≈ 440 px without a label and ≈ 540 px once the
 * label size appears, so half follows the state. The exact width moves a few pixels with
 * the word lengths ("Elbow" / "Left-aligned"); centring does not need that precision.
 */
const LINE_BAR_HALF = 220;
const LINE_BAR_LABEL_HALF = 270;

/** Screen box of a widget, centre-anchored like the canvas is. */
function screenBox(widget: Widget, frame: Frame) {
  const { camera, viewport } = frame;
  return {
    left:
      (widget.x - camera.x) * camera.zoom +
      viewport.width / 2 -
      (widget.width * camera.zoom) / 2,
    top:
      (widget.y - camera.y) * camera.zoom +
      viewport.height / 2 -
      (widget.height * camera.zoom) / 2,
    width: widget.width * camera.zoom,
    height: widget.height * camera.zoom,
  };
}

/** One quiet "+" on a side of the selected object (ADR-195). */
export interface EdgeContinueTarget {
  direction: NoteDirection;
  /** Top-left of the 44 px hit area, centred on the side. */
  left: number;
  top: number;
}

/**
 * The four edge targets around a selected note or shape.
 *
 * The visual disc is 24 px and the hit area 44 px, so the button is placed half its hit
 * area outside the side's midpoint. The caller draws the disc inside the button; the
 * arithmetic here is only where the hit area goes.
 */
/**
 * The 44 px hit area sits outside the edge, past the connector anchor.
 *
 * The old target was centred on the edge, so its disc and hit area covered the anchor
 * dot at `ANCHOR_GAP`: two affordances on one point, one of them invisible as a choice.
 * Moving the quiet + out keeps the anchor on the edge and the + beside it.
 */
export const EDGE_CONTINUE_OFFSET = 30;

export function edgeContinueTargets(widget: Widget, frame: Frame): EdgeContinueTarget[] {
  const box = screenBox(widget, frame);
  const half = 22;
  const gap = EDGE_CONTINUE_OFFSET;
  return [
    { direction: "left", left: box.left - half - gap, top: box.top + box.height / 2 - half },
    { direction: "right", left: box.left + box.width - half + gap, top: box.top + box.height / 2 - half },
    { direction: "up", left: box.left + box.width / 2 - half, top: box.top - half - gap },
    { direction: "down", left: box.left + box.width / 2 - half, top: box.top + box.height - half + gap },
  ];
}

/** The note/shape bar: colour, text and size controls for the object itself. */
export function noteBarTarget(args: {
  widget: Widget;
  frame: Frame;
  settings: BoardSettings;
  marks: TextMarks | null;
  /** The canvas palette, for the ground of a caption (ADR-273). */
  palette?: CanvasPalette;
  resolve?: (id: string) => Widget | undefined;
}): StickyBarTarget | null {
  const { widget, frame, settings, marks } = args;
  if (widget.type !== "sticky_note" && widget.type !== "text" && widget.type !== "shape") {
    return null;
  }

  const screen = screenBox(widget, frame);
  const half =
    widget.type === "shape"
      ? SHAPE_BAR_HALF
      : widget.type === "text"
        ? TEXT_BAR_HALF
        : NOTE_BAR_HALF;
  const placement = {
    left: Math.max(
      8,
      Math.min(
        screen.left + screen.width / 2 - half,
        frame.viewport.width - half * 2 - 8,
      ),
    ),
    top: barTop(screen, frame.viewport),
  };

  const runs: TextRun[] = widget.runs?.length
    ? widget.runs
    : [{ text: widget.content ?? widget.title ?? "" }];
  const autoSize =
    noteFontSizeFor(
      runs,
      widget.width,
      widget.height,
      textCapFor(widget, settings.notes.fontCap),
      undefined,
      textFloorFor(widget),
      settings.text.fontFamily,
    ) ?? 16;

  const fill =
    widget.type === "sticky_note"
      ? stickyFill(widget.style?.fillColor)
      : (widget.style?.fillColor ?? DEFAULT_FILL);
  // The surface the bar's warning is measured against: the sheet's own fill, or the
  // canvas/frame body for a caption with no fill (ADR-273 §2.3).
  const palette = args.palette ?? DEFAULT_PALETTE;
  const ground = groundOfWidget(widget, palette, { resolve: args.resolve });

  return {
    id: widget.id,
    kind:
      widget.type === "shape"
        ? ("shape" as const)
        : widget.type === "text"
          ? ("text" as const)
          : ("note" as const),
    rect: screen,
    placement,
    fillColor: widget.style?.fillColor,
    textColor: widget.type === "text" ? widget.style?.color : widget.style?.textColor,
    ink: inkFor(
      widget.type === "sticky_note" || widget.type === "shape" ? fill : ground,
      widget.type === "text" ? widget.style?.color : widget.style?.textColor,
    ).color,
    ground,
    strokeColor: widget.style?.strokeColor,
    strokeWidth: widget.style?.strokeWidth,
    strokeStyle: widget.style?.strokeStyle,
    shapeKind: widget.type === "shape" ? (widget.shapeKind ?? "rectangle") : undefined,
    size: (widget.style?.stickySize ?? "M") as StickySize,
    fontSize: widget.style?.fontSize ?? null,
    autoSize,
    align: widget.style?.textAlign ?? "center",
    vAlign: widget.style?.textVAlign ?? "middle",
    marks,
    ...(widget.lines?.length ? { lines: widget.lines } : {}),
    richBlocks: kindOf(widget.type).richBlocks,
    editable: !widget.locked,
  };
}

/**
 * The arrange bar: two or more selected objects.
 *
 * Groups count once — aligning a group must not collapse it into a column. The bar still
 * appears for a pair of connectors, where there is nothing to align but the shared line
 * colour and Delete apply (ADR-120); `canArrange` says whether Align and Distribute do.
 */
export function arrangeBarTarget(args: {
  selectedIds: readonly string[];
  frame: Frame;
  resolve: (id: string) => Widget | undefined;
}): ArrangeBarTarget | null {
  const { selectedIds, frame, resolve } = args;
  if (selectedIds.length < 2) return null;

  const selected = selectedIds
    .map((id) => resolve(id))
    .filter((widget): widget is Widget => Boolean(widget));
  if (selected.length < 2) return null;

  const units = new Set<string>();
  for (const widget of selected) {
    if (widget.type === "card" || widget.type === "connector") continue;
    if (widget.parentId) continue;
    units.add(widget.groupId ?? widget.id);
  }
  const allConnectors = selected.every((widget) => widget.type === "connector");
  // A group alone has nothing to arrange; a pair of lines has a shared colour.
  if (units.size < 2 && !allConnectors) return null;

  const boxes = selected.map((widget) => boxOf(widget));
  const box = unionBox(boxes);
  if (!box) return null;

  const left = frame.viewport.width / 2 + (box.x - frame.camera.x) * frame.camera.zoom;
  const top = frame.viewport.height / 2 + (box.y - frame.camera.y) * frame.camera.zoom;
  const width = box.width * frame.camera.zoom;
  const height = box.height * frame.camera.zoom;

  const counts = new Map<string, number>();
  for (const widget of selected) counts.set(widget.type, (counts.get(widget.type) ?? 0) + 1);

  // The kind switch belongs to a selection made only of shapes; a mixed selection has
  // no single type to change, so the item is hidden rather than disabled (ADR-271).
  const allShapes = selected.every((widget) => widget.type === "shape");
  const shapeKinds: ShapeKind[] = allShapes
    ? selected.map((widget) => widget.shapeKind ?? "rectangle")
    : [];

  const barWidth = shapeKinds.length ? ARRANGE_BAR_WIDTH_SHAPES : ARRANGE_BAR_WIDTH;
  return {
    units: units.size,
    objects: selected.length,
    canArrange: units.size >= 2,
    canGather: selected.filter((widget) => GATHERABLE_TYPES.has(widget.type)).length >= 2,
    shapeKinds,
    types: [...counts.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type)),
    colour: commonColour(selected),
    placement: {
      left: Math.max(
        8,
        Math.min(
          left + width / 2 - barWidth / 2,
          frame.viewport.width - barWidth - 8,
        ),
      ),
      top: barTop({ top, height }, frame.viewport, COMPACT_BAR_ROOM),
    },
  };
}

/**
 * The one colour role a multi-selection shares, or null when it shares none.
 *
 * Fill is the role of notes and shapes, the line colour is the role of connectors; a
 * selection that mixes a note with a line has no common role, so the bar offers no colour
 * rather than writing to half of the selection. "Mixed" is a state, not a value: it says
 * the objects disagree instead of pretending one of them is common (ADR-120).
 */
export function commonColour(
  widgets: readonly Widget[],
): { role: "fill" | "line"; value: string; mixed: boolean } | null {
  if (widgets.length === 0) return null;
  if (widgets.every((widget) => widget.type === "connector")) {
    // An absent colour is Auto, its own state: comparing it with a stored hex says the
    // selection does not share one colour, which is the honest answer (ADR-273).
    const values = widgets.map((widget) => (widget.style?.strokeColor ?? "").toLowerCase());
    return { role: "line", value: values[0]!, mixed: new Set(values).size > 1 };
  }
  if (widgets.every((widget) => widget.type === "sticky_note" || widget.type === "shape")) {
    const values = widgets.map((widget) =>
      (widget.type === "sticky_note"
        ? stickyFill(widget.style?.fillColor)
        : (widget.style?.fillColor ?? DEFAULT_FILL)
      ).toLowerCase(),
    );
    return { role: "fill", value: values[0]!, mixed: new Set(values).size > 1 };
  }
  return null;
}

/**
 * The connector bar: just above the line's own bounding box.
 *
 * The box is measured from the *path*, not from the widget's stored rectangle: a curve
 * leaves the chord behind, and a bar floating over the chord would be pointing at empty
 * space (ADR-042).
 */
export function connectorBarTarget(args: {
  widget: Widget;
  frame: Frame;
  settings: BoardSettings;
  resolve: (id: string) => Widget | undefined;
  palette?: CanvasPalette;
}): ConnectorBarTarget | null {
  const { widget, frame, settings, resolve } = args;
  const palette = args.palette ?? DEFAULT_PALETTE;
  if (widget.type !== "connector" || widget.locked) return null;

  const path = connectorPath(widget, resolve, {
    max: settings.connectors.stubMax,
    ratio: settings.connectors.stubRatio,
  });
  if (!path) return null;

  const points = pathPolyline(path);
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const { camera, viewport } = frame;
  // A multi-line label grows above the line; the bar must clear the chip, not the path
  // (ADR-213), or it covers the first line of the text it edits.
  const label = widget.content?.trim();
  const chip = label
    ? labelMetrics(label, widget.style?.fontSize ?? 13, settings.text.fontFamily)
    : null;
  const anchor = labelPoint(path, widget.labelAt);
  const topWorld = chip ? Math.min(Math.min(...ys), anchor.y - chip.height / 2) : Math.min(...ys);
  const left = viewport.width / 2 + (Math.min(...xs) - camera.x) * camera.zoom;
  const right = viewport.width / 2 + (Math.max(...xs) - camera.x) * camera.zoom;
  const top = viewport.height / 2 + (topWorld - camera.y) * camera.zoom;
  const bottom = viewport.height / 2 + (Math.max(...ys) - camera.y) * camera.zoom;

  const centre = (left + right) / 2;
  // A line without text is the narrow bar; with text it grows by the label size and
  // the label's own colour role, so its half changes with it (ADR-120).
  const hasLabel = Boolean(widget.content?.trim());
  const half = hasLabel ? LINE_BAR_LABEL_HALF : LINE_BAR_HALF;
  return {
    id: widget.id,
    placement: {
      left: Math.max(8, Math.min(centre - half, viewport.width - half * 2 - 8)),
      top: barTop({ top, height: bottom - top }, viewport, COMPACT_BAR_ROOM),
    },
    routing: routingOf(widget),
    strokeStyle: widget.style?.strokeStyle ?? "normal",
    strokeWidth: widget.style?.strokeWidth ?? 2,
    // Auto is the strong ladder of the canvas ground; the sample shows what is painted.
    strokeColor: inkFor(palette.canvas, widget.style?.strokeColor, "lineStrong").color,
    strokeColorStored: widget.style?.strokeColor,
    ground: palette.canvas,
    arrow: widget.arrow ?? "none",
    hasLabel,
    fontSize: widget.style?.fontSize ?? null,
    textColor: widget.style?.textColor,
    ink: inkFor(palette.paper, widget.style?.textColor).color,
  };
}

/**
 * The picture bar: Replace, Description, Open and More (`spec/images.md` §9.5).
 *
 * Measured at 1440 in English: Replace + Description + two icon buttons ≈ 372 px, so half
 * of it keeps the bar centred on the picture.
 */
const IMAGE_BAR_HALF = 186;

export function imageBarTarget(args: {
  widget: Widget;
  frame: Frame;
}): ImageBarTarget | null {
  const { widget, frame } = args;
  if (widget.type !== "image") return null;
  const screen = screenBox(widget, frame);
  return {
    id: widget.id,
    rect: screen,
    placement: {
      left: Math.max(
        8,
        Math.min(
          screen.left + screen.width / 2 - IMAGE_BAR_HALF,
          frame.viewport.width - IMAGE_BAR_HALF * 2 - 8,
        ),
      ),
      top: barTop(screen, frame.viewport, COMPACT_BAR_ROOM),
    },
    x: widget.x,
    y: widget.y,
    width: widget.width,
    alt: widget.alt,
    fileId: widget.fileId,
    naturalWidth: widget.naturalWidth,
    naturalHeight: widget.naturalHeight,
    locked: Boolean(widget.locked),
  };
}
