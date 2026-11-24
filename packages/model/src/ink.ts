/**
 * Ink knows its paper (ADR-273, `spec/ink-on-ground.md`).
 *
 * The colour of anything that lies *on* a surface — text, counters, grid lines, icons,
 * "+", placeholders, the caret — is a function of the surface under it, never of the
 * theme. The theme chooses the canvas ground and the chrome; a fill is document data and
 * does not change with the theme; the ink follows whatever it lands on.
 *
 * Two functions are the whole mechanism:
 *  - `groundOf` resolves the surface: the object's own fill, else its container's, else
 *    the canvas ground of the current theme;
 *  - `ink` picks a colour from one of two fixed ladders for the role the part plays.
 *
 * A second contrast calculation anywhere else is a defect: `ink.matrix.test.ts` walks every
 * part of every kind over every palette fill in both themes.
 */

/** The role a part plays on its ground, and so the contrast it must reach. */
export type InkRole = "text" | "muted" | "icon" | "line" | "lineStrong";

/**
 * The two ladders: ink on light paper, paper on dark ink (ADR-273 §2.2).
 *
 * The values are the design system's `neutral-900`, ink primitives and `paper-cream`
 * scale; the model carries them because a document may not reference a stylesheet
 * (ADR-127). `ink.test.ts` pins them to the primitives `tokens.json` ships.
 */
export const INK_LADDER = ["#1e2136", "#3f4256", "#62657a"] as const;
export const PAPER_LADDER = ["#fbf3df", "#d9d2c0", "#b4ad9c"] as const;

/** The minimum contrast of a role, from WCAG AA for text and 3:1 for a strong edge. */
const MINIMUM: Record<Exclude<InkRole, "line">, number> = {
  text: 4.5,
  muted: 4.5,
  icon: 3,
  lineStrong: 3,
};

/**
 * A line must be visible without shouting (ADR-273 §2.2): a hairline at 1.25–1.6:1 reads
 * as a line, a 3:1 hairline reads as a border. The target is the middle of the band.
 */
export const LINE_CONTRAST = { min: 1.25, max: 1.6, target: 1.42 } as const;

/** Below this a person's own colour is unreadable on its ground and gets a halo. */
export const INK_HALO_FLOOR = 2;

/**
 * The stored inks that mean "the person chose nothing" (ADR-273 §2.3).
 *
 * `#58534e` is grey 600, what a free text used to store; `#1a1a1a` is the near-black
 * `readableInk` wrote on a light fill; `#1e2136` is the ink a shape's Plain preset stored
 * as its outline and `#595959` the old line stroke. An old document is not rewritten: the
 * value reads as Auto, exactly like ADR-186's old default fill.
 */
const AUTO_INKS = new Set(["#58534e", "#1a1a1a", "#1e2136", "#595959"]);

/** The value a stored ink really represents: itself, or nothing when it is an old default. */
export function autoInk(stored: string | null | undefined): string | undefined {
  if (!stored) return undefined;
  const value = normalizeHex(stored);
  return value && AUTO_INKS.has(value) ? undefined : stored;
}

/** The ink a part paints with, and the halo when a person's colour nearly disappears. */
export interface Ink {
  /** The colour to paint with, as CSS accepts it. */
  color: string;
  /** A 1.5 px halo in the ground's own ink, or null when the colour reads on its own. */
  halo: string | null;
}

/**
 * Ink for content on `ground`: the person's colour when they chose one, else the ladder's.
 *
 * A stored value equal to an old default reads as Auto (ADR-273 §2.3). An explicit colour
 * is never replaced; when it falls below 2:1 against its ground the caller also draws a
 * halo in `ink(ground, "text")`, so text never vanishes into its paper.
 */
export function inkFor(
  ground: string,
  stored?: string | null,
  role: InkRole = "text",
): Ink {
  const explicit = autoInk(stored);
  if (!explicit) return { color: ink(ground, role), halo: null };
  const needsHalo =
    (role === "text" || role === "muted") && contrastRatio(explicit, ground) < INK_HALO_FLOOR;
  return { color: explicit, halo: needsHalo ? ink(ground, "text") : null };
}

/** One surface a piece of content can lie on, nearest first (ADR-273 §2.1). */
export interface GroundLayers {
  /** The object's own fill; absent or `transparent` lets the container show through. */
  fill?: string | null;
  /** How much of the own fill covers what is below it; 1 (opaque) by default. */
  fillAlpha?: number;
  /** The fill of the container: a kanban board, a table, a frame's body. */
  container?: string | null;
  /** How much of the container covers the canvas: a frame body is 0.75. */
  containerAlpha?: number;
  /** The canvas ground of the current theme (`palette.canvas`). */
  canvas: string;
}

/**
 * The surface under a part: its own fill, else its container's, else the canvas ground.
 *
 * A translucent layer is mixed with what is under it here, once, so no painter mixes by
 * hand and two painters cannot disagree about a frame body's colour.
 */
export function groundOf(layers: GroundLayers): string {
  const container =
    layers.container && layers.container !== "transparent"
      ? mix(layers.container, layers.containerAlpha ?? 1, layers.canvas)
      : layers.canvas;
  if (!layers.fill || layers.fill === "transparent") return container;
  return mix(layers.fill, layers.fillAlpha ?? 1, container);
}

/** How much of a frame body covers the canvas (ADR-267: paper at 75 %). */
export const FRAME_BODY_ALPHA = 0.75;

/**
 * The ink for `role` on `ground` (ADR-273 §2.2).
 *
 * The ladder's rungs are tried in order and the first that reaches the role's contrast
 * wins; when both sides reach it the dark side wins — the character is ink on paper. A
 * line is the exception: it takes the side *away* from the ground's own tone at the alpha
 * that lands it inside the hairline band, so a grid on dark paper is light and never a
 * darker groove. The result is cached by `(ground, role)`.
 */
export function ink(ground: string, role: InkRole): string {
  const key = `${role}|${ground}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const value = chooseInk(ground, role);
  if (cache.size > 1024) cache.clear();
  cache.set(key, value);
  return value;
}

const cache = new Map<string, string>();

function chooseInk(ground: string, role: InkRole): string {
  // A line takes the ladder on the other side of its ground: the dark canvas is the ink
  // itself, so its grid must be paper, not a darker groove.
  const darkFirst =
    role !== "line" || luminance(ground) > luminance(INK_LADDER[0]) + 0.01;
  const ladders = darkFirst
    ? [INK_LADDER, PAPER_LADDER]
    : [PAPER_LADDER, INK_LADDER];
  let fallback: string = INK_LADDER[0];
  let fallbackContrast = 0;
  for (const ladder of ladders) {
    for (const rung of ladder) {
      const colour = role === "line" ? hairline(rung, ground) : rung;
      const ratio = colour ? contrastRatio(colour, ground) : 0;
      if (ratio > fallbackContrast) {
        fallback = colour ?? rung;
        fallbackContrast = ratio;
      }
      if (colour && passes(role, ratio)) return colour;
    }
  }
  // A mid-tone ground can fail both ladders for text; the readable extreme is still a
  // better answer than a colour with no contrast at all.
  return fallback;
}

function passes(role: InkRole, ratio: number): boolean {
  if (role === "line") return ratio >= LINE_CONTRAST.min && ratio <= LINE_CONTRAST.max;
  return ratio >= MINIMUM[role];
}

/** The alpha of `base` over `ground` that lands the hairline in the middle of its band. */
function hairline(base: string, ground: string): string | null {
  if (contrastRatio(base, ground) < LINE_CONTRAST.target) return null;
  let low = 0;
  let high = 1;
  for (let step = 0; step < 24; step += 1) {
    const mid = (low + high) / 2;
    if (contrastRatio(mix(base, mid, ground), ground) < LINE_CONTRAST.target) low = mid;
    else high = mid;
  }
  const parts = parse(base);
  if (!parts) return null;
  return `rgba(${parts.r}, ${parts.g}, ${parts.b}, ${(Math.round(((low + high) / 2) * 1000) / 1000).toFixed(3)})`;
}

/** WCAG relative luminance of a colour's channels; a translucent one is read opaque. */
export function luminance(colour: string): number {
  const channelsValue = parse(colour);
  if (!channelsValue) return 0;
  return 0.2126 * linear(channelsValue.r) + 0.7152 * linear(channelsValue.g) + 0.0722 * linear(channelsValue.b);
}

/** WCAG contrast ratio between two colours; a translucent one is read over the other. */
export function contrastRatio(a: string, b: string): number {
  const top = composite(a, b);
  const high = Math.max(luminance(top), luminance(b));
  const low = Math.min(luminance(top), luminance(b));
  return (high + 0.05) / (low + 0.05);
}

/** `fill` at `alpha` over `below`, as a hex colour. */
export function mix(fill: string, alpha: number, below: string): string {
  const top = parse(fill);
  const base = parse(below);
  if (!top || !base) return fill;
  const a = clamp(alpha);
  const blend = (one: number, two: number) => Math.round(one * a + two * (1 - a));
  return toHex(blend(top.r, base.r), blend(top.g, base.g), blend(top.b, base.b));
}

/** A colour as it looks over `below`: identical for an opaque one, mixed for a translucent one. */
export function composite(colour: string, below: string): string {
  const value = parse(colour);
  if (!value) return colour;
  if (value.a >= 1) return colour;
  return mix(toHex(value.r, value.g, value.b), value.a, below);
}

function linear(value: number): number {
  const channel = value / 255;
  return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 1));
}

interface Channels {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** `#abc`, `#rrggbb` and `rgba(r, g, b, a)`; everything else is not a colour we mix. */
function parse(colour: string): Channels | null {
  const raw = colour.trim().toLowerCase();
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(raw);
  if (rgb) {
    return {
      r: Number(rgb[1]),
      g: Number(rgb[2]),
      b: Number(rgb[3]),
      a: rgb[4] === undefined ? 1 : clamp(Number(rgb[4])),
    };
  }
  const value = normalizeHex(raw);
  if (!value) return null;
  const number = parseInt(value.slice(1), 16);
  return { r: (number >> 16) & 0xff, g: (number >> 8) & 0xff, b: number & 0xff, a: 1 };
}

function normalizeHex(colour: string): string | null {
  const raw = colour.trim().replace("#", "").toLowerCase();
  if (raw.length === 3) return `#${raw.split("").map((char) => char + char).join("")}`;
  return /^[0-9a-f]{6}$/.test(raw) ? `#${raw}` : null;
}

function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}
