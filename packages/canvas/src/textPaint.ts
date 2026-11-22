/**
 * Text inside a box: one line drawer and one box drawer.
 *
 * Kept apart from the widget switch because both the note/shape box and the text
 * widget draw through them, and because the painter file has a line limit. The font,
 * the padding and the line height come from `textLayout`, so this file places lines
 * and never decides their size.
 */
import type { TextRun, Widget } from "@remo/model";
import { stickyFill } from "@remo/model";
import { type CanvasPalette, DEFAULT_PALETTE, withAlpha } from "./palette";
import { roundRect } from "./path";
import {
  type BlockLine,
  type BlockMarker,
  BULLET_GLYPHS,
  CHECKBOX_EM,
  CHECKBOX_RADIUS,
  CHECKBOX_STROKE,
  CHECKED_TEXT_ALPHA,
  LINK_UNDERLINE,
  layoutWidgetBlocks,
  MARKER_GAP_EM,
  type WidgetBlockLayout,
} from "./textBlocks";
import {
  DEFAULT_FONT_FAMILY,
  fitNoteFont,
  fontFor,
  layoutRuns,
  lineHeightFor,
  linesClipped,
  notePadding,
  type RichLine,
  textFloorFor,
} from "./textLayout";
import { CODE_PADDING_EM } from "./textMetrics";

/** Colours a block's marker or link may need that the caller's fillStyle cannot answer. */
export interface BlockPaint {
  palette: CanvasPalette;
  /** True on a sticky note: the sheet's ink, never a chrome colour (README REMO 2.0). */
  paper: boolean;
  /** The sheet's own colour, for the tick inside a filled checkbox. */
  paperFill: string;
}

/**
 * Draw one line of formatted text.
 *
 * `align` matters for the widget being painted: a sticky note is left-aligned, a
 * text block is centred, so the line is measured twice — once per segment to place
 * it, once in total to shift it.
 */
export function drawRichLine(
  ctx: CanvasRenderingContext2D,
  line: RichLine,
  x: number,
  /** Top of the line box, or its vertical centre when `centre` is set. */
  y: number,
  fontPx: number,
  align: "left" | "center" | "right",
  centre = false,
  family: string = DEFAULT_FONT_FAMILY,
  paint: BlockPaint = { palette: DEFAULT_PALETTE, paper: false, paperFill: DEFAULT_PALETTE.panel },
): void {
  let cursor = align === "center" ? x - line.width / 2 : align === "right" ? x - line.width : x;
  const ink = ctx.fillStyle as string;

  // Underline and strikethrough belong to the text's baseline, not to the line box:
  // with the baseline guessed from the box top they drifted into the letters.
  // The ascent must be measured with the font this line is drawn in: measuring it
  // before setting the font used whichever widget painted last, and the first line of
  // every block landed a few pixels off (a fitted label then looked clipped at the top).
  // The ascent is measured against the baseline, so the baseline mode must be set
  // before the probe: with the caller's `top` still active the ascent came out
  // negative and the first line of every block was drawn a few pixels too high.
  let font = fontFor(fontPx, line.segments[0], family);
  ctx.font = font;
  ctx.textBaseline = "alphabetic";
  const probe = ctx.measureText("Mg");
  const ascent = probe.actualBoundingBoxAscent || fontPx * 0.8;
  const descent = probe.actualBoundingBoxDescent || fontPx * 0.2;
  const baseline = centre ? y + (ascent - descent) / 2 : y + ascent;

  for (const segment of line.segments) {
    // One font per mark set: the first segment already wears the font the probe used,
    // and most lines are plain, so a paint no longer parses the same font per segment.
    const next = fontFor(fontPx, segment, family);
    if (next !== font) {
      ctx.font = next;
      font = next;
    }

    // Inline code is a plate: the padding belongs to the segment, not to its letters.
    const pad = segment.code ? fontPx * CODE_PADDING_EM : 0;
    const width = ctx.measureText(segment.text).width + pad * 2;
    if (segment.code) {
      ctx.fillStyle = withAlpha(ink, 0.14);
      roundRect(ctx, cursor, baseline - fontPx, width, fontPx * 1.3, CHECKBOX_RADIUS);
      ctx.fill();
      ctx.fillStyle = ink;
    }

    // A link on paper keeps the object's ink (content is never recoloured); on a white
    // text block it is the accent, which is the only place the token may be used (§7).
    if (segment.href) ctx.fillStyle = paint.paper ? ink : paint.palette.textAccent;
    ctx.fillText(segment.text, cursor + pad, baseline);
    if (segment.href) ctx.fillStyle = ink;

    const lineWidth = segment.code ? fontPx * 0.18 : Math.max(1, fontPx / 14);
    if ((segment.underline && !segment.code) || segment.strike || segment.href) {
      ctx.strokeStyle = ctx.fillStyle as string;
      ctx.lineWidth = lineWidth;
      if (segment.href) {
        ctx.beginPath();
        ctx.moveTo(cursor + pad, baseline + fontPx * 0.13);
        ctx.lineTo(cursor + width - pad, baseline + fontPx * 0.13);
        ctx.stroke();
      }
      if (segment.underline && !segment.code) {
        ctx.beginPath();
        ctx.moveTo(cursor + pad, baseline + fontPx * 0.13);
        ctx.lineTo(cursor + width - pad, baseline + fontPx * 0.13);
        ctx.stroke();
      }
      if (segment.strike) {
        ctx.beginPath();
        ctx.moveTo(cursor + pad, baseline - fontPx * 0.3);
        ctx.lineTo(cursor + width - pad, baseline - fontPx * 0.3);
        ctx.stroke();
      }
    }

    cursor += width;
  }
}

/* -------------------------------------------------------------- blocks ---- */

/** Colour of a checked line: muted on white, the ink at 55 % on paper. */
function checkedColour(paint: BlockPaint, ink: string): string {
  return paint.paper ? ink : paint.palette.textMuted;
}

function drawMarker(
  ctx: CanvasRenderingContext2D,
  marker: BlockMarker,
  line: BlockLine,
  x: number,
  top: number,
  baseline: number,
  em: number,
  family: string,
  ink: string,
  paint: BlockPaint,
): void {
  if (marker.kind === "none") return;
  ctx.fillStyle = ink;
  ctx.strokeStyle = ink;

  if (marker.kind === "bullet") {
    ctx.font = fontFor(em, {}, family);
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(marker.glyph || BULLET_GLYPHS[0], x, top + line.h / 2);
    return;
  }

  if (marker.kind === "number") {
    ctx.font = fontFor(em, {}, family);
    ctx.textAlign = "right";
    ctx.textBaseline = "alphabetic";
    const right = x + marker.width - em * MARKER_GAP_EM;
    ctx.fillText(marker.glyph, right, baseline);
    return;
  }

  // The checkbox: a 0.8 em square, `radius-xs`, 1.5-unit ink; filled and ticked when set.
  // It sits at the start of the marker column, not centred in it, so the words keep a
  // gap wide enough to read as a separate control.
  const side = em * CHECKBOX_EM;
  const left = x + em * 0.1;
  const boxTop = top + (line.h - side) / 2;
  ctx.lineWidth = CHECKBOX_STROKE;
  ctx.beginPath();
  roundRect(ctx, left, boxTop, side, side, CHECKBOX_RADIUS);
  if (marker.checked) {
    ctx.fillStyle = ink;
    ctx.fill();
    ctx.fillStyle = paint.paper ? paint.paperFill : paint.palette.panel;
    ctx.font = `600 ${side * 0.78}px ${family}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("✓", left + side / 2, boxTop + side / 2 + side * 0.02);
    ctx.fillStyle = ink;
  } else {
    ctx.stroke();
  }
}

/** Draw one block line's runs, with code plates, links and a checked item's strike. */
function drawBlockRuns(
  ctx: CanvasRenderingContext2D,
  line: BlockLine,
  x: number,
  baseline: number,
  family: string,
  ink: string,
  paint: BlockPaint,
): void {
  const checked = line.checked;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  if (checked) {
    ctx.fillStyle = checkedColour(paint, ink);
    ctx.globalAlpha = paint.paper ? CHECKED_TEXT_ALPHA : 1;
  } else {
    ctx.fillStyle = ink;
  }

  for (const run of line.runs) {
    const font = fontFor(line.fontPx, run.marks, family, line.weight);
    ctx.font = font;

    if (run.marks.code) {
      ctx.fillStyle = withAlpha(checked ? checkedColour(paint, ink) : ink, 0.14);
      roundRect(ctx, x + run.x, baseline - line.fontPx, run.width, line.fontPx * 1.3, CHECKBOX_RADIUS);
      ctx.fill();
      ctx.fillStyle = checked ? checkedColour(paint, ink) : ink;
    }

    if (!checked) {
      if (run.marks.href) ctx.fillStyle = paint.paper ? ink : paint.palette.textAccent;
      else if (!run.marks.code) ctx.fillStyle = ink;
    }
    ctx.fillText(run.text, x + run.x + run.pad, baseline);

    const underline = (run.marks.underline && !run.marks.code) || Boolean(run.marks.href);
    if (underline) {
      ctx.strokeStyle = ctx.fillStyle as string;
      ctx.lineWidth = run.marks.href ? LINK_UNDERLINE : Math.max(1, line.fontPx / 14);
      ctx.beginPath();
      ctx.moveTo(x + run.x + run.pad, baseline + line.fontPx * 0.13);
      ctx.lineTo(x + run.x + run.width - run.pad, baseline + line.fontPx * 0.13);
      ctx.stroke();
    }
    // A checked item is struck through whether or not the words carry a strike mark.
    if (run.marks.strike || checked) {
      ctx.strokeStyle = ctx.fillStyle as string;
      ctx.lineWidth = Math.max(1, line.fontPx / 14);
      ctx.beginPath();
      ctx.moveTo(x + run.x + run.pad, baseline - line.fontPx * 0.3);
      ctx.lineTo(x + run.x + run.width - run.pad, baseline - line.fontPx * 0.3);
      ctx.stroke();
    }
    if (!checked) ctx.fillStyle = ink;
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = ink;
}

/**
 * Draw the block layout of a widget and say whether it was clipped.
 *
 * The layout is the one `textHitAt` and `blocksClipped` compute, so a checkbox is
 * painted where it is clicked and the mark agrees with the badge.
 */
export function drawBlocks(
  ctx: CanvasRenderingContext2D,
  measured: WidgetBlockLayout,
  family: string,
  ink: string,
  paint: BlockPaint,
): void {
  const { layout, contentX, contentY } = measured;
  ctx.textAlign = "left";
  for (const line of layout.lines) {
    const top = contentY + line.top;
    const baseline = contentY + line.baseline;
    if (line.marker.kind !== "none") {
      drawMarker(
        ctx,
        line.marker,
        line,
        contentX + line.marker.x,
        top,
        baseline,
        line.fontPx,
        family,
        ink,
        paint,
      );
    }
    if (line.runs.length) drawBlockRuns(ctx, line, contentX, baseline, family, ink, paint);
  }
}

/* ------------------------------------------------------------------ box --- */

/**
 * Draw a widget's text inside its box.
 *
 * Shared by sticky notes and shapes so both get the same Auto sizing, the same three
 * alignments, the same runs and the same underline placement. `clip` keeps text from
 * spilling over a physical object's edge.
 */
export function drawTextInBox(
  ctx: CanvasRenderingContext2D,
  widget: Widget,
  box: { x: number; y: number; width: number; height: number },
  family: string,
  options: {
    cap: number;
    align: "left" | "center" | "right";
    vAlign: "top" | "middle" | "bottom";
    clip?: boolean;
    palette?: CanvasPalette;
  },
): boolean {
  const palette = options.palette ?? DEFAULT_PALETTE;
  const ink = ctx.fillStyle as string;
  const paper = widget.type === "sticky_note";
  const paint: BlockPaint = {
    palette,
    paper,
    paperFill: paper ? stickyFill(widget.style?.fillColor) : palette.panel,
  };

  // Block text takes the block layout, exactly as it was measured for the fit; every
  // other note keeps the inline path below, byte for byte (ADR-252, rule 2).
  if (widget.lines?.length) {
    const measured = layoutWidgetBlocks(ctx, widget, box, options.cap, family, {
      align: options.align,
      vAlign: options.vAlign,
    });
    if (!measured) return false;
    ctx.save();
    if (options.clip) {
      ctx.beginPath();
      ctx.rect(box.x, box.y, box.width, box.height);
      ctx.clip();
    }
    const clipped =
      measured.layout.height >
      Math.max(box.height - measured.padding * 2, lineHeightFor(measured.size)) + 0.5;
    drawBlocks(ctx, measured, family, ink, paint);
    ctx.restore();
    return clipped;
  }

  const content = widget.content ?? "";
  const runs: TextRun[] = widget.runs?.length ? widget.runs : content ? [{ text: content }] : [];
  if (!runs.length) return false;

  const explicit = widget.style?.fontSize;
  const size =
    explicit ??
    fitNoteFont(ctx, runs, box.width, box.height, options.cap, textFloorFor(widget), family);

  const padding = notePadding(size);
  const lines = layoutRuns(ctx, runs, Math.max(box.width - padding * 2, 8), size, family);
  const lineHeight = lineHeightFor(size);
  const total = lines.length * lineHeight;
  const startY =
    options.vAlign === "top"
      ? box.y + padding
      : options.vAlign === "bottom"
        ? box.y + box.height - padding - total
        : box.y + (box.height - total) / 2;
  const lineX =
    options.align === "left"
      ? box.x + padding
      : options.align === "right"
        ? box.x + box.width - padding
        : box.x + box.width / 2;

  ctx.save();
  if (options.clip) {
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.width, box.height);
    ctx.clip();
  }
  ctx.textAlign = "left";
  lines.forEach((line, i) => {
    drawRichLine(ctx, line, lineX, startY + i * lineHeight, size, options.align, false, family, paint);
  });
  ctx.restore();
  // The mark comes from the lines this paint already laid out: asking again through
  // `textClipped` would fit and wrap every label a second time, per frame (ADR-214).
  return linesClipped(lines.length, lineHeight, box.height, padding);
}
