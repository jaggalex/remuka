import type { CardStatus, Ink, TagColor, Widget } from "@remo/model";
import type { CanvasPalette } from "./palette";
import { fillWithHalo } from "./textPaint";

/** The small print on a card: status, assignee and date range (ADR-106 amendment). */
export interface CardMetaTheme {
  fontFamily: string;
  palette: CanvasPalette;
  statusLabel: Record<CardStatus, string>;
  /**
   * The card's ink, picked from the sheet's fill (ADR-267, ADR-273), with the halo a
   * person's nearly invisible colour needs. Required: a card without an answer would be
   * a card painted in the chrome's colour, which is the defect ADR-273 removes.
   */
  ink: Ink;
  /** Halo width in world units, so 1.5 px on screen at any zoom; 1.5 when absent. */
  haloWidth?: number;
  /** The room's tag vocabulary (ADR-102), so the face can name a card's tags. */
  tags?: ReadonlyMap<string, { name: string; color: TagColor }>;
  /** The person's colour by account id (ADR-078, ADR-267 §2.1): the assignee's circle. */
  assigneeColor?: (accountId: string) => string;
}

/** At most this many tags on a face; the rest are in the panel (ADR-106). */
export const CARD_FACE_TAGS = 3;

/** The tags a card face shows, in the card's own order, skipping deleted ids. */
export function faceTags(
  card: Widget,
  tags: CardMetaTheme["tags"],
): Array<{ name: string; color: TagColor }> {
  if (!tags) return [];
  return (card.tagIds ?? [])
    .map((id) => tags.get(id))
    .filter((tag): tag is { name: string; color: TagColor } => Boolean(tag))
    .slice(0, CARD_FACE_TAGS);
}

const TAG_PAD = 6;
const TAG_GAP = 4;

/** One line of tag chips from `x`, clipped to `rightEdge`: a chip that does not fit is left out. */
function drawTagChips(
  ctx: CanvasRenderingContext2D,
  chips: Array<{ name: string; color: TagColor }>,
  x: number,
  y: number,
  rightEdge: number,
  theme: CardMetaTheme,
): void {
  const height = 14;
  ctx.font = `600 9px ${theme.fontFamily}`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  let left = x;
  for (const chip of chips) {
    let label = chip.name;
    let width = ctx.measureText(label).width + TAG_PAD * 2;
    // A long name is shortened rather than pushed off the card.
    while (left + width > rightEdge && label.length > 2) {
      label = `${label.slice(0, -2)}…`;
      width = ctx.measureText(label).width + TAG_PAD * 2;
    }
    if (left + width > rightEdge) break;
    // A tag is content: a white plate with an ink outline, not a coloured chip that
    // would fight the card's fill (ADR-267 §2.1).
    ctx.fillStyle = theme.palette.objectPaper;
    ctx.beginPath();
    const r = height / 2;
    ctx.moveTo(left + r, y - r);
    ctx.arcTo(left + width, y - r, left + width, y + r, r);
    ctx.arcTo(left + width, y + r, left, y + r, r);
    ctx.arcTo(left, y + r, left, y - r, r);
    ctx.arcTo(left, y - r, left + width, y - r, r);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = theme.ink.color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = theme.ink.color;
    ctx.fillText(label, left + TAG_PAD, y);
    left += width + TAG_GAP;
  }
}

export interface CardFace {
  left: number;
  top: number;
  width: number;
  height: number;
  /** Baseline for the title when the card also carries meta; undefined keeps centre. */
  titleY: number;
}

function shortDate(value: string | undefined): string {
  if (!value) return "";
  return value.slice(5).replace("-", ".");
}

function range(card: Widget): string {
  const start = shortDate(card.startAt);
  const due = shortDate(card.dueAt);
  if (start && due) return `${start} — ${due}`;
  return start || due;
}

/** Local calendar date, so "overdue" does not flip at UTC midnight. */
function today(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * Draw the card's meta line and return the title baseline.
 *
 * A card without meta keeps its title centred. With meta, the title moves up and the
 * badges sit on the lower line. This is shared by the standalone card and the kanban
 * matrix, so the two cannot drift.
 *
 * Sizes are world units, like the title (ADR-235): the small print belongs to the card and
 * scales with it. The numbers are the ones it had at 100 %.
 */
export function drawCardMeta(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  width: number,
  height: number,
  card: Widget,
  theme: CardMetaTheme,
): number {
  const hasMeta = Boolean(card.status || card.assigneeName || card.startAt || card.dueAt);
  const chips = faceTags(card, theme.tags);
  const ink = theme.ink;
  const haloWidth = theme.haloWidth ?? 1.5;
  if (!hasMeta && chips.length === 0) return top + height / 2;
  const y = top + height - 13;
  const upperY = y - 17;
  const canWrap = height >= 68;
  const leftEdge = left + 12;
  const rightEdge = left + width - 12;
  const gap = 6;
  const radius = 7;
  const hasAvatar = Boolean(card.assigneeName) && rightEdge - leftEdge >= 2 * radius;
  const avatarLeft = hasAvatar ? rightEdge - 2 * radius : rightEdge;
  const dateFont = `9.5px ${theme.fontFamily}`;
  ctx.font = dateFont;
  ctx.textBaseline = "middle";

  const dates = range(card);
  const overdue = Boolean(card.dueAt && card.dueAt < today());
  const dateLabel = overdue ? `! ${dates}` : dates;
  const dateWidth = ctx.measureText(dateLabel).width;
  let bottomRight = hasAvatar ? avatarLeft - gap : rightEdge;
  let upperRight = rightEdge;
  const dateAbove = Boolean(dates) && canWrap && dateWidth > bottomRight - leftEdge &&
    dateWidth <= rightEdge - leftEdge;
  const dateRight = dateAbove ? upperRight : bottomRight;
  if (dates && dateWidth <= dateRight - leftEdge) {
    ctx.fillStyle = overdue ? theme.palette.danger : ink.color;
    ctx.textAlign = "right";
    fillWithHalo(ctx, dateLabel, dateRight, dateAbove ? upperY : y, ink.halo, haloWidth);
    if (dateAbove) upperRight -= dateWidth + gap;
    else bottomRight -= dateWidth + gap;
  }

  const status = card.status ? theme.statusLabel[card.status] ?? card.status : "";
  const statusWidth = status ? 11 + ctx.measureText(status).width : 0;
  const statusAbove = Boolean(status) && canWrap && statusWidth <= upperRight - leftEdge &&
    (chips.length > 0 || statusWidth > bottomRight - leftEdge);
  let upperLeft = leftEdge;
  let bottomLeft = leftEdge;
  if (status && statusWidth <= (statusAbove ? upperRight : bottomRight) - leftEdge) {
    const statusY = statusAbove ? upperY : y;
    ctx.fillStyle = ink.color;
    ctx.beginPath();
    ctx.arc(leftEdge + 3, statusY, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.textAlign = "left";
    fillWithHalo(ctx, status, leftEdge + 11, statusY, ink.halo, haloWidth);
    if (statusAbove) upperLeft += statusWidth + gap;
    else bottomLeft += statusWidth + gap;
  }

  // Move the smallest prefix of tags up, in order, leaving the rest beside the date
  // and avatar. A short card has only the lower row; a long tag is ellipsised there.
  ctx.font = `600 9px ${theme.fontFamily}`;
  const chipWidths = chips.map(chip => ctx.measureText(chip.name).width + TAG_PAD * 2);
  let bottomWidth = chipWidths.reduce((total, w) => total + w + TAG_GAP, -TAG_GAP);
  let split = 0;
  let upperSpace = upperRight - upperLeft;
  while (canWrap && split < chips.length && bottomWidth > bottomRight - bottomLeft) {
    const w = chipWidths[split]!;
    if (w > upperSpace && upperSpace <= bottomRight - bottomLeft) break;
    if (upperSpace < 14) break;
    bottomWidth -= w + TAG_GAP;
    upperSpace -= w + TAG_GAP;
    split++;
  }
  drawTagChips(ctx, chips.slice(0, split), upperLeft, upperY, upperRight, theme);
  drawTagChips(ctx, chips.slice(split), bottomLeft, y, bottomRight, theme);

  if (hasAvatar && card.assigneeName) {
    const initials = card.assigneeName.trim().split(/\s+/)
      .map(part => part.slice(0, 1).toUpperCase()).join("").slice(0, 2);
    const person = card.assigneeId && theme.assigneeColor?.(card.assigneeId);
    const centre = rightEdge - radius;
    ctx.fillStyle = person || theme.palette.objectPaper;
    ctx.strokeStyle = ink.color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(centre, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = person ? theme.palette.textOnPresence : ink.color;
    ctx.font = `600 8px ${theme.fontFamily}`;
    ctx.textAlign = "center";
    fillWithHalo(ctx, initials || "?", centre, y, ink.halo, haloWidth);
  }
  ctx.textAlign = "left";
  const twoRows = statusAbove || split > 0 || dateAbove;
  return twoRows ? (top + upperY - 7) / 2 : top + height / 2 - 8;
}
