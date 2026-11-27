import type { LineFormat, TextLine, TextMarks, TextRun, Widget } from "@remo/model";
import { localPointOf, stickyFontCap } from "@remo/model";
import { measureContext } from "./measure";
import {
  CODE_PADDING_EM,
  DEFAULT_FONT_FAMILY,
  fontFor,
  lineHeightFor,
  MAX_SHAPE_HEIGHT,
  MIN_NOTE_FONT,
  MIN_SHAPE_FONT,
  notePadding,
  STICKY_BOTTOM_PADDING,
} from "./textMetrics";

/**
 * Block text: headings, lists, checklists and their wrapped lines (ADR-252 §7).
 *
 * One pure layout for every reader. The painter draws the lines it returns, the hit
 * test looks for a checkbox in the same lines, the fitter searches for the largest
 * font whose layout fits, and the height functions measure that layout. A second
 * implementation would drift, and the drift would be a checkbox that is drawn here
 * and clicked there.
 *
 * The numbers are ratios of `em`, the object's current text size, never pixels: a note
 * that Auto shrinks draws the same structure at a smaller size. The two constants that
 * come from the design system (`radius-xs` and the 1 px link underline) are named below
 * with the token they mirror.
 *
 * Text without `lines` never reaches this module: the inline path in `textLayout` and
 * `textPaint` keeps its old layout byte for byte (ADR-252, rule 2).
 */

/* ------------------------------------------------------------- geometry ---- */

/** `h1` and `h2` are 1.5 and 1.25 of the object's em, both semibold. */
export const HEADING_SCALE = { h1: 1.5, h2: 1.25 } as const;
export const HEADING_WEIGHT = 600;
/** Space above a heading that is not the first line, and below it, in em. */
export const HEADING_SPACE_BEFORE = 0.4;
export const HEADING_SPACE_AFTER = 0.2;
/** One list level (`indent` 0–2) is 1.5 em. */
export const LIST_INDENT_EM = 1.5;
/** A marker sits in a column 1.25 em wide. */
export const MARKER_COLUMN_EM = 1.25;
/** Room between the widest number and the text after it. */
export const MARKER_GAP_EM = 0.4;
export const BULLET_GLYPHS = ["•", "◦", "▪"] as const;
/** The checkbox square: 0.8 em, `radius-xs`, a 1.5-unit outline. */
export const CHECKBOX_EM = 0.8;
export const CHECKBOX_RADIUS = 2;
export const CHECKBOX_STROKE = 1.5;
/** A link's underline is one unit, like the design system's 1 px. */
export const LINK_UNDERLINE = 1;
/** Checked text is struck and dimmed, not coloured: rule §7 and the owner's decision. */
export const CHECKED_TEXT_ALPHA = 0.55;
/** A block text is never shorter than the three lines a note always keeps. */
export const BLOCK_MIN_LINES = 3;
/** A block may not ask for more height than a shape is allowed to grow (ADR-214). */
export const MAX_BLOCK_HEIGHT = MAX_SHAPE_HEIGHT;

/* --------------------------------------------------------------- results --- */

export interface BlockRun {
  text: string;
  marks: TextMarks;
  /** Left edge, relative to the block's content box. */
  x: number;
  width: number;
  /** Horizontal room inside an inline-code plate, one side. */
  pad: number;
  /** Character range within the source line, for a link hit. */
  from: number;
  to: number;
}

export interface BlockMarker {
  kind: "none" | "bullet" | "number" | "check";
  glyph: string;
  checked: boolean;
  /** Left edge of the marker column, relative to the content box. */
  x: number;
  /** Width of the marker column; the text starts at `x + width`. */
  width: number;
}

/** One laid-out visual line: a source line may produce several of these. */
export interface BlockLine {
  /** Index of the source line in `TextLine[]`, the id `setLineFormat` takes. */
  index: number;
  block?: LineFormat["block"];
  indent: 0 | 1 | 2;
  checked: boolean;
  ordinal?: number;
  /** Top of the line box, relative to the block's content box. */
  top: number;
  /** Height of the line box, heading sizes included. */
  h: number;
  /** Alphabetic baseline, relative to the block's content box. */
  baseline: number;
  fontPx: number;
  weight: number;
  marker: BlockMarker;
  /** Left edge of the text, relative to the content box. */
  x: number;
  /** Width of the text on this visual line, without the marker column. */
  width: number;
  runs: BlockRun[];
}

export interface BlockLayout {
  lines: BlockLine[];
  /** Height of the whole block, without the box padding. */
  height: number;
  /** Widest right edge, alignment included; the block's own width. */
  width: number;
}

export interface BlockLayoutOptions {
  /** Width available for the block, marker columns included. */
  width: number;
  /** The object's em: the size ordinary text is set at. */
  fontPx: number;
  family?: string;
  align?: "left" | "center" | "right";
}

/* ---------------------------------------------------------------- layout --- */

/** The em a line is set at: a heading is larger than the object's ordinary text. */
function emOf(line: TextLine, fontPx: number): number {
  if (line.block === "h1") return fontPx * HEADING_SCALE.h1;
  if (line.block === "h2") return fontPx * HEADING_SCALE.h2;
  return fontPx;
}

function weightOf(line: TextLine): number {
  return line.block === "h1" || line.block === "h2" ? HEADING_WEIGHT : 400;
}

function isList(block: LineFormat["block"] | undefined): boolean {
  return block === "bullet" || block === "ordered" || block === "check";
}

/**
 * The width of every ordered group's widest number.
 *
 * Numbering resets by the §2.4 rule: an ordinary line of the same or a smaller level
 * starts a new group, a deeper line belongs to the item above it. The map is keyed by
 * the group's first source-line index, which is stable for this layout only.
 */
function orderedColumns(
  ctx: CanvasRenderingContext2D,
  lines: readonly TextLine[],
  fontPx: number,
  family: string,
): Map<number, number> {
  const groupOf = new Map<number, number>();
  const open: Array<number | null> = [null, null, null];
  let sequence = 0;

  lines.forEach((line, index) => {
    if (line.block === "ordered") {
      for (let level = line.indent + 1; level < open.length; level += 1) open[level] = null;
      if (open[line.indent] == null) {
        sequence += 1;
        open[line.indent] = sequence;
      }
      groupOf.set(index, open[line.indent]!);
      return;
    }
    // Any line of this level or a shallower one closes the groups it interrupts.
    for (let level = line.indent; level < open.length; level += 1) open[level] = null;
  });

  const widest = new Map<number, number>();
  ctx.font = fontFor(fontPx, {}, family);
  for (const [index, group] of groupOf) {
    const ordinal = lines[index]!.ordinal ?? 1;
    const width = ctx.measureText(`${ordinal}.`).width;
    widest.set(group, Math.max(widest.get(group) ?? 0, width));
  }

  // The gap keeps a number from touching the words after it; the column is the widest
  // number of the group, so a group that reaches `10.` is wider than one that stops at 9.
  const columns = new Map<number, number>();
  for (const [index, group] of groupOf) {
    columns.set(index, (widest.get(group) ?? 0) + fontPx * MARKER_GAP_EM);
  }
  return columns;
}

interface Piece {
  text: string;
  marks: TextMarks;
  width: number;
  from: number;
  to: number;
  pad: number;
}

interface WrappedLine {
  pieces: Piece[];
  width: number;
}

/** Width of a piece with its marks, code plate included. */
function measurePiece(
  ctx: CanvasRenderingContext2D,
  text: string,
  marks: TextMarks,
  fontPx: number,
  weight: number,
  family: string,
): { width: number; pad: number } {
  ctx.font = fontFor(fontPx, marks, family, weight);
  const pad = marks.code ? fontPx * CODE_PADDING_EM : 0;
  return { width: ctx.measureText(text).width + pad * 2, pad };
}

/**
 * Greedy wrap of one source line's runs.
 *
 * Words wrap together with the marks they carry, a list continuation keeps the same
 * left edge (the hanging indent comes from the caller), and an inline-code run stays a
 * plate as wide as its words unless it has to be broken. A word wider than the line is
 * split at the boundary, like the plain path.
 */
function wrapRuns(
  ctx: CanvasRenderingContext2D,
  runs: readonly TextRun[],
  maxWidth: number,
  fontPx: number,
  weight: number,
  family: string,
): WrappedLine[] {
  const lines: WrappedLine[] = [];
  let current: WrappedLine = { pieces: [], width: 0 };
  const limit = Math.max(maxWidth, 8);

  const push = (): void => {
    lines.push(current);
    current = { pieces: [], width: 0 };
  };

  const add = (piece: Piece): void => {
    const last = current.pieces[current.pieces.length - 1];
    const same =
      last &&
      last.pad === piece.pad &&
      keyOf(last.marks) === keyOf(piece.marks) &&
      last.to === piece.from;
    if (same) {
      last.text += piece.text;
      last.to = piece.to;
      last.width += piece.width;
    } else {
      current.pieces.push(piece);
    }
    current.width += piece.width;
  };

  /** Break one long token into pieces that each fit, without losing a character. */
  const breakToken = (
    text: string,
    marks: TextMarks,
    from: number,
    fontPx: number,
    weight: number,
    family: string,
  ): void => {
    let rest = text;
    let offset = from;
    while (rest.length > 1 && measurePiece(ctx, rest, marks, fontPx, weight, family).width > limit) {
      let cut = rest.length;
      while (
        cut > 1 &&
        measurePiece(ctx, rest.slice(0, cut), marks, fontPx, weight, family).width > limit
      ) {
        cut -= 1;
      }
      const part = rest.slice(0, cut);
      const measured = measurePiece(ctx, part, marks, fontPx, weight, family);
      add({ text: part, marks, width: measured.width, from: offset, to: offset + part.length, pad: measured.pad });
      push();
      rest = rest.slice(cut);
      offset += cut;
    }
    if (!rest) return;
    const measured = measurePiece(ctx, rest, marks, fontPx, weight, family);
    add({ text: rest, marks, width: measured.width, from: offset, to: offset + rest.length, pad: measured.pad });
  };

  let offset = 0;
  for (const run of runs) {
    const marks: TextMarks = {
      ...(run.bold ? { bold: true } : {}),
      ...(run.italic ? { italic: true } : {}),
      ...(run.underline ? { underline: true } : {}),
      ...(run.strike ? { strike: true } : {}),
      ...(run.code ? { code: true } : {}),
      ...(run.href ? { href: run.href } : {}),
    };
    // Inline code wraps as a plate: its spaces are part of the code, not break points
    // that would split the background into unrelated chips.
    const tokens = run.code
      ? [run.text]
      : run.text.split(/(\s+)/).filter((token) => token.length > 0);

    for (const token of tokens) {
      const from = offset;
      offset += token.length;
      if (!token) continue;
      const measured = measurePiece(ctx, token, marks, fontPx, weight, family);
      const space = /^\s+$/.test(token);

      if (space) {
        // Whitespace at the start of a line is the wrap's, not the text's.
        if (current.width === 0) continue;
        if (current.width + measured.width > limit) {
          push();
          continue;
        }
        add({ text: token, marks, width: measured.width, from, to: from + token.length, pad: measured.pad });
        continue;
      }

      if (current.width > 0 && current.width + measured.width > limit) push();
      if (measured.width > limit) {
        breakToken(token, marks, from, fontPx, weight, family);
        continue;
      }
      add({ text: token, marks, width: measured.width, from, to: from + token.length, pad: measured.pad });
    }
  }

  lines.push(current);
  return lines;
}

function keyOf(marks: TextMarks): string {
  return `${marks.bold ? "b" : ""}${marks.italic ? "i" : ""}${marks.underline ? "u" : ""}${marks.strike ? "s" : ""}${marks.code ? "c" : ""}${marks.href ?? ""}`;
}

/** Ascent and descent of the font, for a baseline inside a line box. */
function verticalMetrics(
  ctx: CanvasRenderingContext2D,
  font: string,
  fontPx: number,
): { ascent: number; descent: number } {
  ctx.font = font;
  ctx.textBaseline = "alphabetic";
  const probe = ctx.measureText("Mg");
  return {
    ascent: probe.actualBoundingBoxAscent || fontPx * 0.8,
    descent: probe.actualBoundingBoxDescent || fontPx * 0.2,
  };
}

/**
 * Lay out block text.
 *
 * Alignment applies to the block as a whole, not to each line: centring a list line by
 * itself would centre its marker too and break the hanging indent. The block's own
 * width is the widest right edge, and the shift is what an object's alignment moves.
 */
export function layoutTextBlocks(
  ctx: CanvasRenderingContext2D,
  source: readonly TextLine[],
  options: BlockLayoutOptions,
): BlockLayout {
  const { width, fontPx, family = DEFAULT_FONT_FAMILY, align = "left" } = options;
  const ordered = orderedColumns(ctx, source, fontPx, family);
  const laid: BlockLine[] = [];
  let top = 0;
  let first = true;

  source.forEach((line, index) => {
    const em = emOf(line, fontPx);
    const weight = weightOf(line);
    const h = lineHeightFor(em);
    const list = isList(line.block);
    const indent = (line.indent ?? 0) * LIST_INDENT_EM * fontPx;
    const column =
      line.block === "ordered"
        ? (ordered.get(index) ?? fontPx * MARKER_COLUMN_EM)
        : list
          ? fontPx * MARKER_COLUMN_EM
          : 0;
    const textX = list ? indent + column : 0;

    // Heading rhythm: air above a heading that follows something, less below it.
    if (!first && (line.block === "h1" || line.block === "h2")) {
      top += fontPx * HEADING_SPACE_BEFORE;
    }
    if (!first && source[index - 1]?.block === "h1") top += fontPx * HEADING_SPACE_AFTER;
    if (!first && source[index - 1]?.block === "h2") top += fontPx * HEADING_SPACE_AFTER;

    const wrapped = wrapRuns(
      ctx,
      line.runs,
      Math.max(width - textX, 8),
      em,
      weight,
      family,
    );

    wrapped.forEach((visual, visualIndex) => {
      const markerBase: BlockMarker =
        visualIndex === 0 && list
          ? {
              kind:
                line.block === "ordered"
                  ? "number"
                  : line.block === "check"
                    ? "check"
                    : "bullet",
              glyph:
                line.block === "ordered"
                  ? `${line.ordinal ?? 1}.`
                  : line.block === "check"
                    ? ""
                    : (BULLET_GLYPHS[line.indent ?? 0] ?? BULLET_GLYPHS[0]),
              checked: line.checked,
              x: indent,
              width: column,
            }
          : { kind: "none", glyph: "", checked: line.checked, x: indent, width: column };

      const font = fontFor(em, visual.pieces[0]?.marks, family, weight);
      const { ascent, descent } = verticalMetrics(ctx, font, em);
      const baseline = top + (h - (ascent + descent)) / 2 + ascent;

      let x = textX;
      const runsLaid = visual.pieces.map((piece) => {
        const run: BlockRun = {
          text: piece.text,
          marks: piece.marks,
          x,
          width: piece.width,
          pad: piece.pad,
          from: piece.from,
          to: piece.to,
        };
        x += piece.width;
        return run;
      });

      laid.push({
        index,
        ...(line.block ? { block: line.block } : {}),
        indent: line.indent,
        checked: line.checked,
        ...(line.ordinal != null ? { ordinal: line.ordinal } : {}),
        top,
        h,
        baseline,
        fontPx: em,
        weight,
        marker: markerBase,
        x: textX,
        width: visual.width,
        runs: runsLaid,
      });
      top += h;
    });
    first = false;
  });

  // An empty text still has one line box: a note with a caret is not a zero-height box.
  if (!laid.length) {
    laid.push({
      index: 0,
      indent: 0,
      checked: false,
      top: 0,
      h: lineHeightFor(fontPx),
      baseline: lineHeightFor(fontPx) * 0.8,
      fontPx,
      weight: 400,
      marker: { kind: "none", glyph: "", checked: false, x: 0, width: 0 },
      x: 0,
      width: 0,
      runs: [],
    });
    top = lineHeightFor(fontPx);
  }

  const blockWidth = laid.reduce((max, line) => Math.max(max, line.x + line.width), 0);
  const shift = align === "center" ? (width - blockWidth) / 2 : align === "right" ? width - blockWidth : 0;
  if (shift !== 0) {
    for (const line of laid) {
      line.x += shift;
      line.marker.x += shift;
      for (const run of line.runs) run.x += shift;
    }
  }

  return { lines: laid, width: blockWidth, height: top };
}

/* ------------------------------------------------------------------- fit --- */

/**
 * Largest em that fits `lines` inside a box.
 *
 * The search is the same as `fitNoteFont`: whole pixels and a monotonic predicate, so a
 * binary search is exact. A block line is taller than a plain one, and a heading taller
 * still, so the plain rule would overfill a note that has both.
 */
export function fitBlockFont(
  ctx: CanvasRenderingContext2D,
  lines: readonly TextLine[],
  width: number,
  height: number,
  cap: number,
  min: number,
  family: string = DEFAULT_FONT_FAMILY,
): number {
  const ceiling = Math.max(min, Math.round(cap));
  const fits = (size: number): boolean => {
    const padding = notePadding(size);
    const layout = layoutTextBlocks(ctx, lines, {
      width: Math.max(width - padding * 2, 8),
      fontPx: size,
      family,
    });
    return layout.height <= Math.max(height - padding * 2, lineHeightFor(size));
  };

  let lo = min;
  let hi = ceiling;
  let best = min;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (fits(mid)) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

export interface WidgetBlockLayout {
  size: number;
  padding: number;
  layout: BlockLayout;
  /** World left edge of the content box. */
  contentX: number;
  /** World top edge of the first block line. */
  contentY: number;
  contentWidth: number;
}

/**
 * The block layout of one widget inside its box, exactly as the painter draws it.
 *
 * The painter, the hit test and the clip check all call this, so what is drawn, what is
 * clicked and what the badge reports are one layout.
 */
export function layoutWidgetBlocks(
  ctx: CanvasRenderingContext2D,
  widget: Widget,
  box: { x: number; y: number; width: number; height: number },
  cap: number,
  family: string = DEFAULT_FONT_FAMILY,
  options: {
    align?: "left" | "center" | "right";
    vAlign?: "top" | "middle" | "bottom";
    /** The size the widget paints at; absent means Auto fits the box. */
    size?: number;
  } = {},
): WidgetBlockLayout | null {
  const lines = widget.lines;
  if (!lines?.length) return null;

  const size =
    options.size ??
    widget.style?.fontSize ??
    fitBlockFont(
      ctx,
      lines,
      box.width,
      box.height,
      cap,
      widget.type === "shape" ? MIN_SHAPE_FONT : MIN_NOTE_FONT,
      family,
    );
  const padding = notePadding(size);
  const contentWidth = Math.max(box.width - padding * 2, 8);
  const align = options.align ?? widget.style?.textAlign ?? "center";
  const layout = layoutTextBlocks(ctx, lines, { width: contentWidth, fontPx: size, family, align });
  const vAlign = options.vAlign ?? widget.style?.textVAlign ?? "middle";
  const contentY =
    vAlign === "top"
      ? box.y + padding
      : vAlign === "bottom"
        ? box.y + box.height - padding - layout.height
        : box.y + (box.height - layout.height) / 2;

  return {
    size,
    padding,
    layout,
    contentX: box.x + padding,
    contentY,
    contentWidth,
  };
}

/**
 * Height a block text needs in a box, measured off-screen.
 *
 * The minimum is the three lines a note has always kept; the maximum is the shape
 * growth cap (ADR-214). Callers decide when to apply it: a paint never writes geometry
 * (ADR-215), and an existing object is not re-fitted because it gained a block format.
 *
 * `linesHeightFor` is the name the specification uses for this question (§7); the
 * block name says what it measures and the alias keeps the spec's word available.
 */
export function blocksHeightFor(
  lines: readonly TextLine[],
  width: number,
  fontPx: number = 16,
  family: string = DEFAULT_FONT_FAMILY,
  ctx: CanvasRenderingContext2D | null = measureContext(),
): number | null {
  if (!ctx) return null;
  const padding = notePadding(fontPx);
  const layout = layoutTextBlocks(ctx, lines, {
    width: Math.max(width - padding * 2, 8),
    fontPx,
    family,
  });
  const minimum = lineHeightFor(fontPx) * BLOCK_MIN_LINES;
  const withPadding = layout.height + padding * 2 + STICKY_BOTTOM_PADDING;
  return Math.min(MAX_BLOCK_HEIGHT, Math.max(minimum, withPadding));
}

/** The specification's name for the same measurement (`spec/rich-text.md` §7). */
export const linesHeightFor = blocksHeightFor;

/** Whether the block text of a widget is clipped at the size it paints at (ADR-214). */export function blocksClipped(
  widget: Widget,
  cap: number,
  family: string = DEFAULT_FONT_FAMILY,
  ctx: CanvasRenderingContext2D | null = measureContext(),
): boolean | null {
  if (!widget.lines?.length) return false;
  if (!ctx) return null;
  const box = {
    x: widget.x - widget.width / 2,
    y: widget.y - widget.height / 2,
    width: widget.width,
    height: widget.height,
  };
  const measured = layoutWidgetBlocks(ctx, widget, box, cap, family);
  if (!measured) return false;
  return measured.layout.height > Math.max(box.height - measured.padding * 2, lineHeightFor(measured.size)) + 0.5;
}

/* ------------------------------------------------------------------- hit --- */

export type TextHit =
  | { kind: "checkbox"; line: number }
  | {
      kind: "link";
      href: string;
      range: { line: number; from: number; to: number };
    };

/**
 * What of a block's text is under a world point.
 *
 * The checkbox is the marker column of a `check` line, not just the drawn square: a
 * 0.8 em square is a small target on a zoomed-out board. A link is the painted run,
 * so a click outside it falls through to the ordinary behaviour.
 */
export function textHitAt(
  widget: Widget,
  point: { x: number; y: number },
  options: {
    family?: string;
    cap?: number;
    ctx?: CanvasRenderingContext2D | null;
  } = {},
): TextHit | null {
  const lines = widget.lines;
  if (!lines?.length) return null;
  const ctx = options.ctx === undefined ? measureContext() : options.ctx;
  if (!ctx) return null;

  // The text is laid out in the object's own axes and painted turned with it, so the
  // point is un-turned before any comparison (ADR-271, T18).
  const at = localPointOf(widget, point);

  const family = options.family ?? DEFAULT_FONT_FAMILY;
  const cap =
    options.cap ??
    (widget.type === "shape"
      ? stickyFontCap("M")
      : stickyFontCap(widget.style?.stickySize ?? "M"));
  const box = {
    x: widget.x - widget.width / 2,
    y: widget.y - widget.height / 2,
    width: widget.width,
    height: widget.height,
  };
  const measured = layoutWidgetBlocks(ctx, widget, box, cap, family);
  if (!measured) return null;

  const top = measured.contentY;
  for (const line of measured.layout.lines) {
    if (at.y < top + line.top || at.y > top + line.top + line.h) continue;

    if (line.marker.kind === "check") {
      const left = measured.contentX + line.marker.x;
      if (at.x >= left && at.x <= left + line.marker.width) {
        return { kind: "checkbox", line: line.index };
      }
    }

    for (const run of line.runs) {
      if (!run.marks.href) continue;
      const left = measured.contentX + run.x;
      if (at.x < left || at.x > left + run.width) continue;
      return {
        kind: "link",
        href: run.marks.href,
        range: { line: line.index, from: run.from, to: run.to },
      };
    }
  }
  return null;
}
