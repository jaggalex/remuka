import {
  CARD_WHITE,
  formatRemaining,
  groundOf,
  ink as inkOn,
  inkFor,
  TONE_LEVELS,
  timerPhase,
  timerRemainingMs,
  type CardStatus,
  type TagColor,
  type TextRun,
  type Widget,
} from "@remo/model";
import { drawCardMeta } from "./cardMeta";
import { groundOfWidget, kanbanGroundOf } from "./ground";
import { paintSticky } from "./stickyPaint";
import {
  connectorPath,
  insetPath,
  labelPoint,
  roundedArrowHead,
  type ArrowHead,
  type ConnectorPath,
} from "./connectors";
import { drawClipMark } from "./clipMark";
import { roundRect } from "./path";
import { CARD_SHADOW, drawCardSheet } from "./cardSheet";
import { castElevation } from "./elevation";
import { drawFrameLabel } from "./frameLabel";
import { imageFieldsOf, paintImage } from "./imagePaint";
import { layoutLabel } from "./labelLayout";
import { drawKanbanPlate } from "./kanbanPlate";
export { deviceScale, roundRect } from "./path";
import { DEFAULT_PALETTE, withAlpha, type CanvasPalette } from "./palette";
import { layoutRuns, textCapFor } from "./textLayout";
import { drawRichLine, drawTextInBox, fillWithHalo } from "./textPaint";


/**
 * Stacking order.
 *
 * The base order per type lives in the model (`layers.ts`) because it is not only a
 * painting detail any more: bring-to-front writes explicit layers, and the document
 * commands have to agree with the painter about what "above" means (ADR-039). These
 * re-exports keep the canvas package's API the same for its callers.
 */
export { PAINT_RANK, layerKey, paintOrder, rankOf } from "@remo/model";


/**
 * Outline left where a dragged object used to be.
 *
 * The object itself follows the pointer, so the original place has to keep saying
 * "something came from here" — without it, a drag looks like a copy. Neutral grey and
 * a dashed hairline, like a shadow rather than a second object. `radius` matches the
 * shape of what was lifted: cards are sheets with `CARD_RADIUS`, everything else is a
 * rectangle.
 */
export function drawDragOrigin(
  ctx: CanvasRenderingContext2D,
  box: { x: number; y: number; width: number; height: number },
  zoom: number,
  radius = 0,
  palette: CanvasPalette = DEFAULT_PALETTE,
): void {
  ctx.save();
  const ghost = inkOn(palette.canvas, "icon");
  ctx.fillStyle = withAlpha(ghost, 0.07);
  ctx.strokeStyle = withAlpha(ghost, 0.6);
  ctx.lineWidth = 1.5 / zoom;
  ctx.setLineDash([6 / zoom, 5 / zoom]);
  if (radius > 0) {
    roundRect(ctx, box.x, box.y, box.width, box.height, Math.min(radius, box.height / 2));
  } else {
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.width, box.height);
  }
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/**
 * One alignment guide, drawn as a dashed line in the accent colour.
 *
 * The line is a hairline regardless of zoom, but the dash pattern is scaled so it
 * keeps the same rhythm on screen instead of turning into a solid stroke when zoomed
 * out or into long dashes when zoomed in.
 */
export function drawGuide(
  ctx: CanvasRenderingContext2D,
  guide: { axis: "x" | "y"; position: number; from: number; to: number },
  zoom: number,
  palette: CanvasPalette = DEFAULT_PALETTE,
): void {
  ctx.save();
  ctx.strokeStyle = palette.selectionStroke;
  ctx.lineWidth = 1 / zoom;
  ctx.setLineDash([5 / zoom, 4 / zoom]);
  ctx.beginPath();
  if (guide.axis === "x") {
    ctx.moveTo(guide.position, guide.from);
    ctx.lineTo(guide.position, guide.to);
  } else {
    ctx.moveTo(guide.from, guide.position);
    ctx.lineTo(guide.to, guide.position);
  }
  ctx.stroke();
  ctx.restore();
}

/** Greedy word wrap; returns the lines that fit into `maxLines`. */
export function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines = 99,
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidth || !line) {
        line = candidate;
      } else {
        lines.push(line);
        line = word;
        if (lines.length >= maxLines) return lines;
      }
    }
    lines.push(line);
    if (lines.length >= maxLines) return lines;
  }
  return lines.slice(0, maxLines);
}

/** Truncate to one line so a caption never overflows its plate. */
function fitOneLine(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let cut = text.length;
  while (cut > 1 && ctx.measureText(`${text.slice(0, cut)}…`).width > maxWidth) cut -= 1;
  return `${text.slice(0, cut)}…`;
}

export interface DrawWidgetOptions {
  /** Looks up a widget by id — connectors need their endpoints' boxes. */
  resolve?: (id: string) => Widget | undefined;
  selectedIds?: readonly string[];
  /** Font family and text-size caps chosen in settings. */
  theme?: PaintTheme;
  /**
   * The object under the inline editor. Its text is left to the DOM editor, so the
   * canvas does not paint a second copy behind it (ADR-033).
   */
  editingId?: string;
  /**
   * True when the selection has many members: the member is drawn with the quiet 1 px
   * ring instead of the active 2 px outline, because the handles belong to the block
   * (ADR-211).
   */
  memberRing?: boolean;
  /** Paint paper square: no tilt on sticky notes (ADR-265), e.g. for kanban cards in columns. */
  straight?: boolean;
  /**
   * How much the sheet is in hand, 0…1 (ADR-265 §4.2): hover lift, growth and
   * straightening; a released note settles from 1 back to 0 with one overshoot.
   */
  hand?: number;
  /** A carried sheet casts a deeper shadow than a hovered one (§4.2). */
  shadowBoost?: boolean;
  /**
   * The fill of a card being painted where its column is known (ADR-267): the colour a
   * card without a fill of its own takes from its column. The matrix computes it for the
   * cards in place; the overlay passes it for a card in flight.
   */
  cardFill?: string;
  /**
   * The decoded picture for an image object, or null while it loads (ADR-249).
   *
   * Loading belongs to the app, not to the painter: the screen reads its cache and an
   * export reads the same cache after preloading, so both paint the same frame. The
   * callback is only asked about objects that are actually being painted, which is
   * what keeps off-screen pictures from loading.
   */
  image?: (widget: Widget) => ImageBitmap | null;
  /** The picture could not be loaded, so the placeholder says so (ADR-249). */
  imageUnavailable?: (widget: Widget) => boolean;
}

/** Visual defaults that come from the person's settings. */
export interface PaintTheme {
  fontFamily: string;
  fontCap: { S: number; M: number; L: number };
  shapeStrokeWidth: number;
  /** Copy shown in an empty card; the app passes its translation. */
  cardPlaceholder: string;
  /** The word on a kanban's title plate when the object has no name of its own. */
  kanbanTitle: string;
  /** Copy shown on a finished shared timer; the app passes its translation. */
  timerExpired: string;
  /** Copy on an image that could not be loaded; the app passes its translation. */
  imageUnavailable?: string;
  /** Card status labels, passed by the app so the canvas stays language-neutral. */
  cardStatus: Record<CardStatus, string>;
  /** Colours resolved from the design-system tokens (`readCanvasTokens()`). */
  palette: CanvasPalette;
  /** The room's tag vocabulary, for tag chips on a card face (ADR-102, ADR-106). */
  tags?: ReadonlyMap<string, { name: string; color: TagColor }>;
}

export const DEFAULT_THEME: PaintTheme = {
  fontFamily: 'Inter, "Helvetica Neue", Arial, sans-serif',
  fontCap: { S: 13, M: 16, L: 20 },
  shapeStrokeWidth: 2,
  cardPlaceholder: "Type something",
  kanbanTitle: "Kanban",
  timerExpired: "Time is up",
  imageUnavailable: "Image unavailable",
  cardStatus: { todo: "To do", in_progress: "In progress", done: "Done" },
  palette: DEFAULT_PALETTE,
};

/** Stroke a connector path: a polyline, or a cubic curve when it has one. */
function drawPath(ctx: CanvasRenderingContext2D, path: ConnectorPath): void {
  ctx.beginPath();
  const start = path.points[0]!;
  ctx.moveTo(start.x, start.y);
  if (path.curve) {
    const { c1, c2, to } = path.curve;
    ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, to.x, to.y);
    return;
  }
  for (let i = 1; i < path.points.length; i += 1) {
    ctx.lineTo(path.points[i]!.x, path.points[i]!.y);
  }
}

/** A head is filled and stroked with a round join, which rounds its three corners. */
function fillHead(ctx: CanvasRenderingContext2D, head: ArrowHead, colour: string): void {
  const [a, b, c] = head.points;
  ctx.save();
  ctx.fillStyle = colour;
  ctx.strokeStyle = colour;
  ctx.lineJoin = "round";
  ctx.lineWidth = head.radius * 2;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(a!.x, a!.y);
  ctx.lineTo(b!.x, b!.y);
  ctx.lineTo(c!.x, c!.y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}


/** Widgets whose paint already failed once; logged once each, not every frame. */
const failedPaints = new Set<string>();

/**
 * Paint one widget, isolated from every other (ADR-171).
 *
 * The board is painted in one loop on one frame. Without this boundary, one object the
 * painter cannot handle threw out of the loop and left the canvas empty for every
 * client in the room, on every frame, because the object is shared. Now the failure
 * costs that object only: the canvas state is restored, the rest of the board paints,
 * and the error is reported once per object so it reaches a bug report.
 */
/** The outline of a shape as a fresh path: the fill, the stroke and its shadow share it. */
function traceShape(ctx: CanvasRenderingContext2D, widget: Widget, left: number, top: number): void {
  const kind = widget.shapeKind ?? "rectangle";
  if (kind === "ellipse") {
    ctx.beginPath();
    ctx.ellipse(widget.x, widget.y, widget.width / 2, widget.height / 2, 0, 0, Math.PI * 2);
  } else if (kind === "diamond" || kind === "triangle") {
    ctx.beginPath();
    if (kind === "diamond") {
      ctx.moveTo(widget.x, top);
      ctx.lineTo(left + widget.width, widget.y);
      ctx.lineTo(widget.x, top + widget.height);
      ctx.lineTo(left, widget.y);
    } else {
      ctx.moveTo(widget.x, top);
      ctx.lineTo(left + widget.width, top + widget.height);
      ctx.lineTo(left, top + widget.height);
    }
    ctx.closePath();
  } else {
    roundRect(ctx, left, top, widget.width, widget.height, kind === "round_rectangle" ? widget.height * 0.3 : 10);
  }
}

export function drawWidget(
  ctx: CanvasRenderingContext2D,
  widget: Widget,
  zoom: number,
  options: DrawWidgetOptions = {},
): void {
  ctx.save();
  try {
    paintWidget(ctx, widget, zoom, options);
  } catch (error) {
    if (!failedPaints.has(widget.id)) {
      failedPaints.add(widget.id);
      console.error(`[canvas] could not paint ${widget.type} ${widget.id}`, error);
    }
  } finally {
    ctx.restore();
  }
}

function paintWidget(
  ctx: CanvasRenderingContext2D,
  widget: Widget,
  zoom: number,
  options: DrawWidgetOptions,
): void {
  const left = widget.x - widget.width / 2;
  const top = widget.y - widget.height / 2;
  const selected = options.selectedIds?.includes(widget.id) ?? false;
  const editing = options.editingId === widget.id;
  const theme = options.theme ?? DEFAULT_THEME;
  const palette = theme.palette;

  switch (widget.type) {
    case "timer": {
      // One card, painted from the stored `endsAt` rather than from a local countdown:
      // two clients, a late joiner and a reconnect all show the same second (ADR-075).
      // It is a piece of cardboard (ADR-267): white paper, an ink edge and a hard shadow.
      const timer = widget.timer;
      const phase = timerPhase(timer);
      const expires = phase === "expired";
      const remaining = expires ? 0 : timerRemainingMs(timer);
      const urgent = !expires && remaining > 0 && remaining <= 10_000;
      ctx.save();
      ctx.fillStyle = palette.objectInk;
      roundRect(ctx, left + CARD_SHADOW.offset, top + CARD_SHADOW.offset, widget.width, widget.height, 10);
      ctx.fill();
      ctx.fillStyle = CARD_WHITE;
      roundRect(ctx, left, top, widget.width, widget.height, 10);
      ctx.fill();
      ctx.strokeStyle = palette.objectInk;
      ctx.lineWidth = 1.5 / zoom;
      ctx.stroke();

      const pad = 14;
      ctx.textBaseline = "top";
      ctx.textAlign = "left";
      // The timer is white cardboard, so its ink is the ink of that paper in both themes
      // (ADR-273 §2.4): a shared timer must not disappear on a dark board.
      const timerInk = expires || urgent
        ? { color: palette.dangerInk, halo: null }
        : inkFor(CARD_WHITE);
      ctx.fillStyle = timerInk.color;
      const value = expires ? "00:00" : formatRemaining(remaining);
      const size = Math.min(46, widget.height * 0.42);
      ctx.font = `800 ${size}px ${theme.fontFamily}`;
      fillWithHalo(ctx, value, left + pad, top + pad, timerInk.halo, 1.5 / zoom);

      const caption = expires
        ? theme.timerExpired
        : phase === "paused"
          ? `${timer?.setBy ?? ""}`.trim()
          : `${timer?.setBy ?? ""}`.trim();
      ctx.font = `400 ${Math.max(9, Math.min(13, size * 0.28))}px ${theme.fontFamily}`;
      ctx.fillStyle = inkOn(CARD_WHITE, "muted");
      ctx.fillText(caption, left + pad, top + widget.height - pad - 12);

      if (phase === "running" || phase === "paused") {
        ctx.fillStyle = phase === "running" ? palette.accent : palette.warning;
        ctx.beginPath();
        ctx.arc(left + widget.width - pad - 4, top + pad + 4, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      break;
    }
    case "frame": {
      castElevation(ctx, widget, zoom, palette, () => roundRect(ctx, left, top, widget.width, widget.height, 18));
      ctx.fillStyle = withAlpha(palette.paper, 0.75);
      roundRect(ctx, left, top, widget.width, widget.height, 18);
      ctx.fill();
      ctx.strokeStyle = palette.objectInk;
      ctx.lineWidth = 1.5 / zoom;
      ctx.stroke();
      // The name is content, so it is painted here: a PNG and a PDF show it too. The
      // plate is also the frame's handle; the gesture machine hit-tests the same box.
      drawFrameLabel(ctx, widget, palette, theme.fontFamily);
      break;
    }
    case "sticky_note": {
      paintSticky(ctx, widget, zoom, {
        palette,
        fontFamily: theme.fontFamily,
        fontCap: theme.fontCap,
        hand: options.hand ?? 0,
        straight: options.straight === true || selected,
        editing,
        shadowBoost: options.shadowBoost === true,
      });
      break;
    }
    case "text": {
      if (editing) break;
      const size = widget.style?.fontSize ?? 16;
      // A caption has no fill: it lies on the canvas ground, or on the frame body it was
      // dropped into, so its ink follows that surface and not the theme (ADR-273 §2.4).
      const ground = groundOfWidget(widget, palette, { resolve: options.resolve });
      const ink = inkFor(ground, widget.style?.color);
      ctx.fillStyle = ink.color;
      const runs: TextRun[] = widget.runs?.length
        ? widget.runs
        : [{ text: widget.title ?? widget.content ?? "" }];
      const hAlign = widget.style?.textAlign ?? "center";
      // A text block with line formats is drawn by the block layout, the same one the
      // hit test and the fit read (ADR-252 §7). Without `lines` the old path below is
      // untouched, byte for byte.
      if (widget.lines?.length) {
        drawTextInBox(
          ctx,
          widget,
          { x: left, y: top, width: widget.width, height: widget.height },
          theme.fontFamily,
          {
            cap: size,
            align: hAlign,
            vAlign: widget.style?.textVAlign ?? "middle",
            palette,
            ground,
            halo: ink.halo,
            haloWidth: 1.5 / zoom,
          },
        );
        break;
      }
      const lines = layoutRuns(ctx, runs, widget.width, size, theme.fontFamily);
      const lineHeight = size * 1.28;
      const offset = ((lines.length - 1) * lineHeight) / 2;
      const lineX =
        hAlign === "left" ? left : hAlign === "right" ? left + widget.width : widget.x;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      lines.forEach((line, i) => {
        drawRichLine(ctx, line, lineX, widget.y - offset + i * lineHeight, size, hAlign, true, theme.fontFamily, {
          palette,
          ground,
          paper: false,
          paperFill: palette.panel,
          halo: ink.halo,
          haloWidth: 1.5 / zoom,
        });
      });
      break;
    }
    case "kanban": {
      // The board's own ground: the landing page's green paper, or the colour someone
      // chose for it (ADR-267 §2.1). The matrix is painted on top by `drawKanban`.
      castElevation(ctx, widget, zoom, palette, () => roundRect(ctx, left, top, widget.width, widget.height, 18));
      ctx.fillStyle = kanbanGroundOf(widget, palette);
      roundRect(ctx, left, top, widget.width, widget.height, 18);
      ctx.fill();
      ctx.strokeStyle = palette.objectInk;
      ctx.lineWidth = 1.5 / zoom;
      ctx.stroke();
      drawKanbanPlate(ctx, widget, palette, theme.fontFamily, theme.kanbanTitle);
      break;
    }
    case "card": {
      // The same sheet as a card in a kanban (ADR-234, ADR-267). The fill is the card's
      // own colour or white paper; a card inside a matrix gets its column's colour from
      // `drawKanban`, which is the only place that knows the column.
      const fill = options.cardFill ?? widget.style?.fillColor ?? CARD_WHITE;
      drawCardSheet(ctx, { x: left, y: top, width: widget.width, height: widget.height }, zoom, { palette, fill });
      const ink = inkFor(fill, widget.style?.textColor);
      const haloWidth = 1.5 / zoom;
      const titleY = drawCardMeta(
        ctx,
        left,
        top,
        widget.width,
        widget.height,
        widget,
        { fontFamily: theme.fontFamily, palette, statusLabel: theme.cardStatus, tags: theme.tags, ink, haloWidth },
      );
      if (editing) break;
      if (widget.title) {
        ctx.fillStyle = ink.color;
        ctx.font = `600 13px ${theme.fontFamily}`;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        const lines = wrapText(ctx, widget.title, widget.width - 24, 2);
        lines.forEach((line, i) => {
          fillWithHalo(
            ctx,
            line,
            left + 12,
            titleY + (i - (lines.length - 1) / 2) * 16,
            ink.halo,
            haloWidth,
          );
        });
      } else {
        // The same placeholder the matrix paints, so a carried empty card does not
        // turn into a blank pill mid-drag.
        ctx.fillStyle = ink.color;
        ctx.font = `13px ${theme.fontFamily}`;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        fillWithHalo(ctx, theme.cardPlaceholder, left + 12, titleY, ink.halo, haloWidth);
      }
      break;
    }
    case "image": {
      // The app decides which variant is decoded; the painter contains it in the
      // object's box and falls back to the dominant colour while nothing is there
      // (ADR-249, `spec/images.md` §6).
      paintImage(
        ctx,
        { x: left, y: top, width: widget.width, height: widget.height },
        zoom,
        {
          bitmap: options.image?.(widget) ?? null,
          dominantColor: imageFieldsOf(widget).dominantColor,
          unavailable: options.imageUnavailable?.(widget) ?? false,
          palette,
          fontFamily: theme.fontFamily,
          unavailableLabel: theme.imageUnavailable,
        },
      );
      break;
    }
    case "shape": {
      // A shape without a fill is a diagram node standing on what is under it: the frame
      // body or the canvas. Its outline and its text take that surface's ink (ADR-273).
      const ground = groundOfWidget(widget, palette, { resolve: options.resolve });
      const fill = widget.style?.fillColor ?? palette.paper;
      const stroke = inkFor(ground, widget.style?.strokeColor, "lineStrong").color;
      ctx.fillStyle = fill;
      ctx.strokeStyle = stroke;
      // Same rule as a connector: the outline is part of the object, so it scales,
      // with a pixel floor so a shape never loses its edge when zoomed out.
      ctx.lineWidth = Math.max(widget.style?.strokeWidth ?? theme.shapeStrokeWidth, 1 / zoom);
      // A dashed outline is the same decision as a dashed line (ADR-120): world units,
      // so the pattern scales with the shape instead of staying screen-sized.
      const dash = widget.style?.strokeStyle;
      if (dash === "dashed") ctx.setLineDash([8, 6]);
      else if (dash === "dotted") ctx.setLineDash([2, 5]);

      const trace = () => traceShape(ctx, widget, left, top);
      castElevation(ctx, widget, zoom, palette, trace);
      trace();
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);

      if (!editing && (widget.content || widget.runs?.length)) {
        const ink = inkFor(ground, widget.style?.textColor);
        ctx.fillStyle = ink.color;
        const clipped = drawTextInBox(ctx, widget, { x: left, y: top, width: widget.width, height: widget.height }, theme.fontFamily, {
          cap: textCapFor(widget, theme.fontCap),
          align: widget.style?.textAlign ?? "center",
          vAlign: widget.style?.textVAlign ?? "middle",
          clip: true,
          palette,
          ground,
          halo: ink.halo,
          haloWidth: 1.5 / zoom,
        });
        if (clipped) drawClipMark(ctx, { x: left, y: top, width: widget.width, height: widget.height }, zoom, palette);
      }
      break;
    }
    case "connector": {
      // Derived from the endpoints, so it follows them without extra writes.
      const resolve = options.resolve;
      const attached = resolve ? connectorPath(widget, resolve) : null;
      if (!attached) break;
      // Drawn a little short of both objects (ADR-184); the label keeps the full path.
      const path = insetPath(attached);

      // A line's thickness, its dashes and its arrow head are properties of the
      // *object*, not of the screen: zooming out must make the whole line smaller,
      // head included. Dividing by zoom here made a head the same 14 pixels at every
      // scale, so at 25% the arrows dwarfed the notes they pointed at (ADR-052).
      // A line has no fill of its own, so it lies on the canvas ground. Auto is the
      // strong ladder there; a person's colour is kept (ADR-273 §2.3).
      const stroke = inkFor(palette.canvas, widget.style?.strokeColor, "lineStrong").color;
      const strokeStyle = widget.style?.strokeStyle;

      // Selection is shown along the line, not around its box: a curved connector
      // bows outside the chord, so its bounding box outlines empty space and reads
      // as a second, wrong line (ADR-042).
      if (selected) {
        ctx.save();
        ctx.strokeStyle = withAlpha(palette.selectionStroke, 0.22);
        ctx.lineWidth = ((widget.style?.strokeWidth ?? 2) + 10) / zoom;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        drawPath(ctx, path);
        ctx.stroke();
        ctx.restore();
      }

      // World units, with a one-device-pixel floor: a 2-unit line at 13% is 0.26px,
      // which all but disappears, and an invisible line is worse than a slightly
      // thick one (ADR-052).
      const width = Math.max(widget.style?.strokeWidth ?? 2, 1 / zoom);
      const first = path.points[0]!;
      const last = path.points[path.points.length - 1]!;
      // The head points along the last segment, not along the chord: on an elbow
      // or a curve those are different directions.
      const beforeLast = path.points[path.points.length - 2] ?? first;
      const afterFirst = path.points[1] ?? last;
      const endHead =
        widget.arrow === "end" || widget.arrow === "both"
          ? roundedArrowHead(last, beforeLast, width)
          : null;
      const startHead =
        widget.arrow === "start" || widget.arrow === "both"
          ? roundedArrowHead(first, afterFirst, width)
          : null;

      // The line stops inside each head, so its round cap never pokes past the point.
      ctx.strokeStyle = stroke;
      ctx.lineWidth = width;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      if (strokeStyle === "dashed") ctx.setLineDash([8, 6]);
      else if (strokeStyle === "dotted") ctx.setLineDash([2, 5]);
      drawPath(ctx, insetPath(path, startHead?.trim ?? 0, endHead?.trim ?? 0));
      ctx.stroke();
      ctx.setLineDash([]);

      if (endHead) fillHead(ctx, endHead, stroke);
      if (startHead) fillHead(ctx, startHead, stroke);

      // A connector can carry text: a chip on its own path, so the label keeps its
      // place when either end moves. Its size and colour are the object's, like a
      // note's (ADR-041, ADR-043).
      const label = widget.content?.trim();
      if (!editing && label) {
        const at = labelPoint(attached, widget.labelAt);
        const fontPx = widget.style?.fontSize ?? 13;
        ctx.font = `600 ${fontPx}px ${theme.fontFamily}`;
        // The chip and the editor share one layout (ADR-213): explicit lines are kept,
        // automatic wrapping stops at three, the guard at eight.
        const metrics = layoutLabel(ctx, label, fontPx);
        const chipWidth = metrics.width;
        const chipHeight = metrics.height;
        ctx.fillStyle = palette.paper;
        ctx.strokeStyle = palette.objectInk;
        ctx.lineWidth = 1.5 / zoom;
        roundRect(ctx, at.x - chipWidth / 2, at.y - chipHeight / 2, chipWidth, chipHeight, 8);
        ctx.fill();
        ctx.stroke();
        const labelInk = inkFor(palette.paper, widget.style?.textColor);
        ctx.fillStyle = labelInk.color;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const firstY = at.y - ((metrics.lines.length - 1) * metrics.lineHeight) / 2;
        metrics.lines.forEach((line, index) => {
          fillWithHalo(
            ctx,
            line,
            at.x,
            firstY + index * metrics.lineHeight + 0.5,
            labelInk.halo,
            1.5 / zoom,
          );
        });
      }
      break;
    }
    case "stamp": {
      // A sticker: a tinted plate with an optional caption. It has no glyph or
      // reaction count — those came from the captured templates and are gone.
      const size = Math.min(widget.width, widget.height);
      const tint = widget.style?.fillColor ?? TONE_LEVELS.yellow[300];
      const radius = size * 0.22;

      ctx.fillStyle = withAlpha(tint, 0.22);
      ctx.strokeStyle = withAlpha(tint, 0.55);
      ctx.lineWidth = 2 / zoom;
      roundRect(ctx, left, top, widget.width, widget.height, radius);
      ctx.fill();
      ctx.stroke();

      if (widget.label) {
        // The caption sits on the tinted plate, so its ink is the plate's, not the theme's.
        const ground = groundOf({ fill: tint, fillAlpha: 0.22, canvas: palette.canvas });
        ctx.fillStyle = inkOn(ground, "muted");
        ctx.font = `600 ${size * 0.115}px ${theme.fontFamily}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const caption = fitOneLine(ctx, widget.label, widget.width - 10);
        ctx.fillText(caption, widget.x, top + widget.height * 0.78);
      }
      break;
    }
    case "unsupported": {
      if (widget.label) {
        // A vertical plate naming a roadmap horizon.
        ctx.save();
        ctx.translate(widget.x, widget.y);
        ctx.rotate(-Math.PI / 2);
        // A plate is content: paper on the canvas, ink derived from that paper.
        ctx.fillStyle = palette.paper;
        ctx.strokeStyle = inkFor(palette.paper, null, "line").color;
        ctx.lineWidth = 1 / zoom;
        roundRect(ctx, -widget.height / 2, -widget.width / 2, widget.height, widget.width, 8);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = inkOn(palette.paper, "muted");
        ctx.font = `600 ${Math.min(widget.width * 0.5, 22)}px ${theme.fontFamily}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(widget.label, 0, 0);
        ctx.restore();
        break;
      }

      ctx.setLineDash([6 / zoom, 4 / zoom]);
      ctx.strokeStyle = inkOn(palette.canvas, "lineStrong");
      ctx.lineWidth = 1 / zoom;
      ctx.strokeRect(left, top, widget.width, widget.height);
      ctx.setLineDash([]);
      break;
    }
    default: {
      // An unknown kind is a plain paper box on the canvas.
      ctx.fillStyle = palette.paper;
      ctx.strokeStyle = inkOn(palette.paper, "line");
      ctx.lineWidth = 1 / zoom;
      roundRect(ctx, left, top, widget.width, widget.height, 4);
      ctx.fill();
      ctx.stroke();
    }
  }

  // A connector shows its selection along the path (above), so it never gets a box.
  if (selected && widget.type !== "connector") {
    const member = options.memberRing === true;
    const inset = (member ? 3 : 2) / zoom;
    ctx.strokeStyle = member ? palette.selectionMember : palette.objectInk;
    ctx.lineWidth = 1.5 / zoom;
    if (member) ctx.setLineDash([4 / zoom, 3 / zoom]);
    ctx.strokeRect(
      left - inset,
      top - inset,
      widget.width + inset * 2,
      widget.height + inset * 2,
    );
    ctx.setLineDash([]);
  }
}
