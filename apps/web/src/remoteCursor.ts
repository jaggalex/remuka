import type { Presence } from "@remo/doc";
import { ink as inkOn } from "@remo/model";
import { DEFAULT_FONT_FAMILY, DEFAULT_PALETTE, type CanvasPalette } from "@remo/canvas";

/**
 * Another person's cursor (ADR-265, `spec/character.md` §3.4).
 *
 * Drawn on the overlay above everything (ADR-056), in screen pixels so it keeps its size at
 * any zoom. The arrow is filled with the person's colour inside a white halo, and beside it
 * sits a plate with their NAME — not initials: people recognise a colleague by name, and the
 * colour only helps. The plate has the person's colour, white text and an ink outline, the
 * same "cardboard" as the rest of the product. Where to draw and how opaque comes from
 * `cursorMotion.ts`; this file only paints.
 */

/** The arrow, tip at the origin, pointing up-left; screen pixels. Same shape as the landing page. */
const ARROW: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [17.6, 7.7],
  [9.9, 9.9],
  [7.7, 17.6],
];

export const REMOTE_CURSOR = {
  /** White halo around the arrow. */
  halo: 3.2,
  plate: { dx: 12, dy: 15, padX: 8, height: 20, radius: 7, border: 1.5, font: 12, maxChars: 22 },
} as const;

/** The name on the plate: the label, shortened so a long name never covers the board. */
export function cursorName(label: string, max: number = REMOTE_CURSOR.plate.maxChars): string {
  const name = label.trim();
  return name.length > max ? `${name.slice(0, max - 1).trimEnd()}…` : name;
}

export function drawRemoteCursor(
  ctx: CanvasRenderingContext2D,
  peer: Presence,
  zoom: number,
  palette: CanvasPalette = DEFAULT_PALETTE,
  fontFamily = DEFAULT_FONT_FAMILY,
  alpha = 1,
): void {
  if (!peer.cursor || alpha <= 0) return;
  const { x, y } = peer.cursor;
  const px = 1 / zoom;
  // Awareness carries the light-theme presence colours in both themes, so the halo and the
  // name stay white on them in both themes (ADR-078); the plate's edge is the one thing
  // that follows the theme, and on the canvas it is the canvas ground's ink (ADR-273).
  const halo = DEFAULT_PALETTE.textOnPresence;
  const ink = inkOn(palette.canvas, "lineStrong");
  const at = (dx: number, dy: number) => [x + dx * px, y + dy * px] as const;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineJoin = "round";
  ctx.beginPath();
  ARROW.forEach(([dx, dy], i) => {
    const [ax, ay] = at(dx, dy);
    if (i === 0) ctx.moveTo(ax, ay);
    else ctx.lineTo(ax, ay);
  });
  ctx.closePath();
  ctx.strokeStyle = halo;
  ctx.lineWidth = REMOTE_CURSOR.halo * px;
  ctx.stroke();
  ctx.fillStyle = peer.color;
  ctx.fill();

  const name = cursorName(peer.label ?? peer.name ?? "");
  if (name) {
    const p = REMOTE_CURSOR.plate;
    ctx.font = `700 ${p.font * px}px ${fontFamily}`;
    const width = ctx.measureText(name).width + p.padX * 2 * px;
    const [left, top] = at(p.dx, p.dy);
    const height = p.height * px;
    ctx.beginPath();
    roundedRect(ctx, left, top, width, height, p.radius * px);
    ctx.fillStyle = peer.color;
    ctx.fill();
    ctx.strokeStyle = ink;
    ctx.lineWidth = p.border * px;
    ctx.stroke();
    ctx.fillStyle = halo;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(name, left + p.padX * px, top + height / 2 + 0.5 * px);
  }
  ctx.restore();
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}
