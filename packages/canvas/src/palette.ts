import type { TagColor } from "@remo/model";
/**
 * The colours Canvas 2D paints with.
 *
 * Canvas cannot read `var(--…)`, so the app resolves the design-system tokens once
 * (`readCanvasTokens()`) and passes the result down here. Keeping the palette a plain
 * object makes the painters pure and testable, and one palette covers the board and
 * the overlay — no second, drifting set of greys (ADR-078).
 *
 * The defaults are the pre-design-system values: they keep unit tests and any caller
 * that paints without the app (exports, thumbnails) working, but the app always passes
 * tokens.
 */
export interface CanvasPalette {
  /**
   * Which theme the tokens were resolved for. Content is painted in the same ink and
   * paper in both themes, so this is read only where a level has no dark version yet
   * ("cardboard", ADR-267 §2.1).
   */
  theme: "light" | "dark";
  /** Board background (`bg-canvas`). */
  canvas: string;
  /** Panels and surfaces (`bg-panel`). */
  panel: string;
  /** Raised surfaces (`bg-raised`). */
  raised: string;
  /** Hover fill (`bg-hover`). */
  hover: string;
  /**
   * Link text on a white object (`text-accent`); on paper the ink is never recoloured.
   *
   * There is no text or border field for content here on purpose (ADR-273 §2.5): a
   * painter that needs ink for something lying on a surface must ask `ink(ground, role)`,
   * so the theme cannot paint light text onto a light document fill.
   */
  textAccent: string;
  accent: string;
  accentSoft: string;
  selectionStroke: string;
  selectionFill: string;
  /** The 1 px ring around a member of a block (ADR-211). */
  selectionMember: string;
  /** The "···" plate for a clipped label (ADR-214). */
  markBg: string;
  markLine: string;
  danger: string;
  warning: string;
  success: string;
  /** Ink on a presence-coloured name plate (`text-on-presence`). */
  textOnPresence: string;
  /** The shadow under a sticky note's bottom edge (`sticker-cast`); paper, so one for both themes. */
  stickerCast: string;
  /** The shadow of a raised and of a floating kanban, frame or shape (ADR-245). */
  raiseCast: string;
  floatCast: string;
  /**
   * The ink of canvas content — a card's outline and hard shadow, an object's label plate
   * (ADR-267). One value in both themes: content is not recoloured.
   */
  objectInk: string;
  /** Paper that sits on that ink: a card's label text on the ink plate (ADR-267). */
  objectPaper: string;
  /** The default ground of a kanban board, drawn under the matrix (ADR-267 §2.1). */
  kanbanGround: string;
  /** The paper of canvas content: a shape's fill, a frame's body, a connector's label (ADR-267). */
  paper: string;
  /** A table's header band, one step warmer than the paper it sits on (ADR-267). */
  tableHead: string;
  /** A table's inner grid: one hairline, warm, in both themes (ADR-267). */
  lineSoft: string;
  /** Danger as ink: an over-limit column header, the dashed outline of its extra cards. */
  dangerInk: string;
  /** The dashed line, hull and ghosts of a plan under review (ADR-188, ADR-267). */
  agent: string;
  /**
   * Tag chips on a card face (ADR-106): the same soft fill and ink as `.tag-<colour>` in
   * the panel, so a tag reads the same on the canvas and beside it.
   */
  tags: Record<TagColor, { fill: string; ink: string }>;
}

export const DEFAULT_PALETTE: CanvasPalette = {
  theme: "light",
  canvas: "#f7f7f8",
  panel: "#ffffff",
  raised: "#ffffff",
  hover: "#f4f5f7",
  textAccent: "#174a96",
  accent: "#4262ff",
  accentSoft: "#eef1ff",
  selectionStroke: "#4262ff",
  selectionFill: "rgba(66,98,255,0.10)",
  selectionMember: "rgba(23,23,22,0.45)",
  markBg: "rgba(255,255,255,0.88)",
  markLine: "rgba(30,33,54,0.28)",
  danger: "#d92d20",
  warning: "#f59e0b",
  success: "#12b76a",
  textOnPresence: "#ffffff",
  stickerCast: "rgba(38,30,22,0.6)",
  raiseCast: "rgba(23,23,22,0.14)",
  floatCast: "rgba(23,23,22,0.2)",
  objectInk: "#1e2136",
  objectPaper: "#ffffff",
  kanbanGround: "#c8e8d4",
  paper: "#fffdf8",
  tableHead: "#fbf3df",
  lineSoft: "#e6dcc4",
  dangerInk: "#8f1c13",
  agent: "#8a35d6",
  tags: {
    blue: { fill: "#eef1ff", ink: "#174a96" },
    green: { fill: "#e7f6ee", ink: "#1f7a4a" },
    yellow: { fill: "#fdf3dc", ink: "#8a5a00" },
    red: { fill: "#fdecea", ink: "#b42318" },
    gray: { fill: "#f4f5f7", ink: "#4b5563" },
  },
};

/** Apply an alpha channel to a hex colour, leaving other formats alone. */
export function withAlpha(color: string, alpha: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  const hex = match?.[1];
  if (!hex) return color;
  const value = parseInt(hex, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
