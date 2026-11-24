import {
  cardFillFor,
  ink,
  inkFor,
  matchColor,
  type CardStatus,
  type TagColor,
  type Widget,
} from "@remo/model";
import { drawCardMeta } from "./cardMeta";
import { CARD_RADIUS, drawCardSheet } from "./cardSheet";
import type { KanbanLayout } from "./layout";
import { DEFAULT_PALETTE, type CanvasPalette } from "./palette";
import { roundRect } from "./path";
import { DEFAULT_FONT_FAMILY } from "./textLayout";
import { fillWithHalo } from "./textPaint";

export interface KanbanPaintOptions {
  selectedIds?: readonly string[];
  /**
   * Placeholder inside an empty card.
   *
   * It is UI copy, so it comes from the caller's translations instead of being baked
   * into the painter (ADR-051).
   */
  placeholder?: string;
  /**
   * Card currently being dragged.
   *
   * It is painted on the overlay layer, following the pointer, so leaving it here as
   * well would show two copies of the same card. Its old place keeps a dashed
   * outline instead (`drawDragOrigin`).
   */
  hiddenCardId?: string | null;
  /** Colours from the design-system tokens; defaults keep tests and exports working. */
  palette?: CanvasPalette;
  /** Font family chosen in settings (Inter by default). */
  fontFamily?: string;
  /** Card records by id, so the face can show status, assignee and dates. */
  cards?: Map<string, Widget>;
  /** Localised status labels; default keeps tests and exports readable. */
  cardStatus?: Record<CardStatus, string>;
  /** The room's tag vocabulary, for tag chips on a card face (ADR-106). */
  tags?: ReadonlyMap<string, { name: string; color: TagColor }>;
  /** The person's colour by account id, for the assignee's circle (ADR-267 §2.1). */
  assigneeColor?: (accountId: string) => string;
  /**
   * The board's own fill: its chosen colour or the default ground (ADR-267 §2.1).
   * Every part of the matrix derives its ink from it (ADR-273 §2.1).
   */
  ground?: string;
}

/** The cell whose empty-cell `+` is under a world point, if any. */
export function plusHit(
  layout: KanbanLayout,
  point: { x: number; y: number },
  zoom: number,
): { columnId: string; swimlaneId: string } | null {
  const radius = 12 / Math.max(zoom, 0.01);
  for (const column of layout.columns) {
    for (const lane of layout.lanes) {
      const occupied = layout.placements.some(
        (placement) =>
          placement.columnId === column.id && placement.swimlaneId === lane.id,
      );
      if (occupied) continue;
      const cx = column.left + layout.padding + 16;
      const cy = lane.centerY;
      if (Math.abs(point.x - cx) <= radius && Math.abs(point.y - cy) <= radius) {
        return { columnId: column.id, swimlaneId: lane.id };
      }
    }
  }
  return null;
}

/**
 * Transient cell highlight, painted on the overlay layer. Keeping it out of the
 * board layer means moving the pointer across a kanban does not repaint the board.
 */
export function drawKanbanHover(
  ctx: CanvasRenderingContext2D,
  layout: KanbanLayout,
  cell: { columnId: string; swimlaneId: string } | null,
  palette: CanvasPalette = DEFAULT_PALETTE,
): void {
  if (!cell) return;
  const column = layout.columns.find((c) => c.id === cell.columnId);
  const lane = layout.lanes.find((l) => l.id === cell.swimlaneId);
  if (!column || !lane) return;

  ctx.fillStyle = palette.selectionFill;
  ctx.fillRect(column.left, lane.top, column.width, lane.height);
}

/** The count beside a column title: `n`, or `n/limit` when the column has a WIP limit. */
export function columnCountText(column: { count: number; wipLimit?: number }): string {
  return column.wipLimit != null ? `${column.count}/${column.wipLimit}` : String(column.count);
}

/** The whole header: the column's name, a dot, and its count (ADR-267 §2.1). */
export function columnHeaderText(column: { title: string; count: number; wipLimit?: number }): string {
  return `${column.title} · ${columnCountText(column)}`;
}

/** A title on the kanban: what it names, and its box in world units. */
export interface KanbanTitleTarget {
  kind: "column" | "lane";
  id: string;
  index: number;
  title: string;
  box: { x: number; y: number; width: number; height: number };
}

/**
 * The title under a point (ADR-244): a column's title and count in the header band, or a
 * lane's title in the strip (ADR-240). The same boxes the painter draws in, so the part
 * that reacts is the part that reads as a title; the rest of the band moves the kanban.
 * `measure` is the text width at a CSS font, from whoever has a context.
 */
export function kanbanTitleAt(
  layout: KanbanLayout,
  point: { x: number; y: number },
  measure: (text: string, font: string) => number,
  fontFamily: string = DEFAULT_FONT_FAMILY,
): KanbanTitleTarget | null {
  for (const target of kanbanTitles(layout, measure, fontFamily)) {
    const { x, y, width, height } = target.box;
    if (point.x >= x && point.x <= x + width && point.y >= y && point.y <= y + height) return target;
  }
  return null;
}

/** Every title box of a kanban, columns first. */
export function kanbanTitles(
  layout: KanbanLayout,
  measure: (text: string, font: string) => number,
  fontFamily: string = DEFAULT_FONT_FAMILY,
): KanbanTitleTarget[] {
  const { top, headerHeight, padding, left, laneStrip } = layout;
  const out: KanbanTitleTarget[] = [];
  const titleY = top + headerHeight * 0.42;
  layout.columns.forEach((column, index) => {
    const width =
      measure(columnHeaderText(column), `800 20px ${fontFamily}`) +
      8;
    const room = column.width - padding * 2;
    out.push({
      kind: "column",
      id: column.id,
      index,
      title: column.title,
      box: { x: column.left + padding - 4, y: titleY - 16, width: Math.min(width, room) + 8, height: 32 },
    });
  });
  if (laneStrip > 0) {
    layout.lanes.forEach((lane, index) => {
      // Up to two title lines and the count, at the top of the lane's strip cell.
      const height = Math.min(lane.height, 30 + 2 * 26 + 14);
      out.push({
        kind: "lane",
        id: lane.id,
        index,
        title: lane.title,
        box: { x: left + padding - 4, y: lane.top + 8, width: laneStrip - padding * 2 + 8, height: height - 8 },
      });
    });
  }
  return out;
}

const FONT = DEFAULT_FONT_FAMILY;

/**
 * Paints a kanban matrix: column headers with live counts, swimlane bands with
 * their own counts, and cards inside cells. Everything comes from `layout`, which
 * also drives hit-testing, so what is drawn is what can be clicked.
 */
export function drawKanban(
  ctx: CanvasRenderingContext2D,
  layout: KanbanLayout,
  zoom: number,
  titles: Map<string, string>,
  options: KanbanPaintOptions = {},
): void {
  const { left, top, width, height, headerHeight, padding } = layout;
  const hairline = 1 / zoom;
  const palette = options.palette ?? DEFAULT_PALETTE;
  const font = options.fontFamily ?? FONT;
  const ground = options.ground ?? palette.kanbanGround;
  const hairlineInk = ink(ground, "line");

  // Column headers: "Name · n" or "Name · n/limit", 800. An over-limit column says so in
  // danger ink; the extra cards carry the dashed outline below. The accent stripe under
  // the title is gone: the cards themselves carry the column's colour (ADR-267 §2.1).
  // A row-600 accent is the header's own colour — that is the only thing it changes, since
  // the cards take the 300 row of the same tone. Everything else is derived ink of the
  // board's ground, which is content and stays light green in both themes (ADR-273,
  // ADR-279).
  for (const column of layout.columns) {
    const over = column.wipLimit != null && column.count > column.wipLimit;
    const accent = matchColor(column.accent);
    const chosen = accent?.exact && accent.color.level === 600 ? column.accent : null;
    const headerInk = inkFor(ground, chosen);
    ctx.fillStyle = over ? palette.dangerInk : headerInk.color;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.font = `800 ${20}px ${font}`;
    fillWithHalo(
      ctx,
      columnHeaderText(column),
      column.left + padding,
      top + headerHeight * 0.42,
      headerInk.halo,
      1.5 / zoom,
    );
  }

  // Swimlane bands and their dividers. A lane's title and count live in the strip on the
  // left, so no card is ever drawn over them (ADR-240).
  const strip = layout.laneStrip;
  layout.lanes.forEach((lane, index) => {
    if (index > 0) {
      ctx.strokeStyle = hairlineInk;
      ctx.lineWidth = hairline;
      ctx.beginPath();
      ctx.moveTo(left + padding, lane.top);
      ctx.lineTo(left + width - padding, lane.top);
      ctx.stroke();
    }
    if (strip <= 0) return;

    ctx.fillStyle = ink(ground, "text");
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.font = `600 ${20}px ${font}`;
    const lines = wrapText(ctx, lane.title, strip - padding * 2, 2);
    lines.forEach((line, row) => {
      ctx.fillText(line, left + padding, lane.top + 30 + row * 26);
    });
    ctx.fillStyle = ink(ground, "muted");
    ctx.font = `${19}px ${font}`;
    ctx.fillText(String(lane.count), left + padding, lane.top + 30 + lines.length * 26);
  });

  // The edge between the lane strip and the first column; columns themselves have no
  // separators in the mockup, the fills and headers do the dividing (ADR-267 §2.1).
  ctx.strokeStyle = hairlineInk;
  ctx.lineWidth = hairline;
  const separators = strip > 0 ? layout.columns.slice(0, 1) : [];
  const lastLane = layout.lanes[layout.lanes.length - 1];
  const bottom = Math.max(top + height, lastLane ? lastLane.top + lastLane.height : 0);
  separators.forEach((column) => {
    ctx.beginPath();
    ctx.moveTo(column.left, top + headerHeight * 0.8);
    ctx.lineTo(column.left, bottom);
    ctx.stroke();
  });

  // Cards beyond a column's WIP limit: the last ones in the column, lane by lane, get the
  // dashed danger outline. The count in the header already says why.
  const extra = new Set<string>();
  for (const column of layout.columns) {
    if (column.wipLimit == null || column.count <= column.wipLimit) continue;
    const inColumn = layout.placements.filter((placement) => placement.columnId === column.id);
    for (const placement of inColumn.slice(column.wipLimit)) extra.add(placement.cardId);
  }
  const accents = new Map(layout.columns.map((column) => [column.id, column.accent]));

  // Cards.
  for (const placement of layout.placements) {
    if (placement.cardId === options.hiddenCardId) continue;
    const cardLeft = placement.x - placement.width / 2;
    const cardTop = placement.y - placement.height / 2;
    const selectedCard = options.selectedIds?.includes(placement.cardId) ?? false;
    const title = titles.get(placement.cardId) ?? "";
    const card = options.cards?.get(placement.cardId);
    // A card without a colour of its own takes its column's (ADR-267 §2.1). The value is
    // computed when painting, so a move recolours the card and writes nothing.
    const fill = card?.style?.fillColor ?? cardFillFor(accents.get(placement.columnId));
    const cardInk = inkFor(fill, card?.style?.textColor);

    ctx.save();

    drawCardSheet(
      ctx,
      { x: cardLeft, y: cardTop, width: placement.width, height: placement.height },
      zoom,
      { palette, selected: selectedCard, fill },
    );

    if (extra.has(placement.cardId)) {
      const out = 3 / zoom;
      ctx.save();
      ctx.strokeStyle = palette.dangerInk;
      ctx.lineWidth = 1.5 / zoom;
      ctx.setLineDash([6 / zoom, 4 / zoom]);
      roundRect(
        ctx,
        cardLeft - out,
        cardTop - out,
        placement.width + out * 2,
        placement.height + out * 2,
        CARD_RADIUS + out,
      );
      ctx.stroke();
      ctx.restore();
    }

    // Meta goes on top of the card fill, so the badges are not painted under it.
    const titleY = card
      ? drawCardMeta(
          ctx,
          cardLeft,
          cardTop,
          placement.width,
          placement.height,
          card,
          {
            fontFamily: font,
            palette,
            statusLabel:
              options.cardStatus ?? { todo: "To do", in_progress: "In progress", done: "Done" },
            tags: options.tags,
            assigneeColor: options.assigneeColor,
            ink: cardInk,
            haloWidth: 1.5 / zoom,
          },
        )
      : placement.y;

    if (title) {
      ctx.fillStyle = cardInk.color;
      ctx.font = `600 ${15}px ${font}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      const lines = wrapText(ctx, title, placement.width - 28, 2);
      const lineHeight = 19;
      const offset = ((lines.length - 1) * lineHeight) / 2;
      lines.forEach((line, index) => {
        fillWithHalo(
          ctx,
          line,
          cardLeft + 14,
          titleY - offset + index * lineHeight,
          cardInk.halo,
          1.5 / zoom,
        );
      });
    } else {
      ctx.fillStyle = cardInk.color;
      ctx.font = `${15}px ${font}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      fillWithHalo(
        ctx,
        options.placeholder ?? "Type something",
        cardLeft + 14,
        titleY,
        cardInk.halo,
        1.5 / zoom,
      );
    }
    ctx.restore();
  }

  // Empty cells keep their `+` affordance.
  for (const column of layout.columns) {
    for (const lane of layout.lanes) {
      // Occupancy counts the dragged card too: its cell is not empty, it is just
      // waiting for the drop.
      const occupied = layout.placements.some(
        (p) => p.columnId === column.id && p.swimlaneId === lane.id,
      );
      if (occupied) continue;
      const cx = column.left + padding + 16;
      const cy = lane.centerY;
      ctx.strokeStyle = ink(ground, "icon");
      ctx.lineWidth = 1.4 / zoom;
      ctx.beginPath();
      ctx.moveTo(cx - 8, cy);
      ctx.lineTo(cx + 8, cy);
      ctx.moveTo(cx, cy - 8);
      ctx.lineTo(cx, cy + 8);
      ctx.stroke();
    }
  }
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
      if (lines.length >= maxLines) return lines;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, maxLines);
}
