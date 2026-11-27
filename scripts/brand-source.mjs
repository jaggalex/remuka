/**
 * One source for the product mark (ADR-272).
 *
 * `docs/design/brand/remuka-mark.svg` and `remuka-mark-dark.svg` are the only pictures
 * of the brand. The app copies, the guide, the legal site and the favicons are built from
 * them, and `brand:check` compares every copy with these files. Nothing here draws the
 * mark: it reads the owner's drawing and changes only the smile's fill to a token.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const BRAND_DIR = join(ROOT, "docs/design/brand");
export const MARK_LIGHT = join(BRAND_DIR, "remuka-mark.svg");
export const MARK_DARK = join(BRAND_DIR, "remuka-mark-dark.svg");
/** PNG derived from the light mark by `scripts/brand-build.mjs` (paper, 1/8 margin). */
export const APPLE_TOUCH = join(BRAND_DIR, "apple-touch-icon.png");

/** Every file the app serves as the mark, and the drawing it copies. */
export const SERVED_MARKS = [
  ["remo-logo.svg", "light"],
  ["apps/web/public/remo-logo.svg", "light"],
  ["apps/web/public/remuka-mark.svg", "light"],
  ["apps/web/public/remuka-mark-dark.svg", "dark"],
];

/** The smile of the light source; the dark source repeats the geometry with paper. */
export const SMILE_LIGHT = "#3f4256";
export const SMILE_DARK = "#fbf3df";

/** Source fills and the role each one takes in a themed surface. */
const ROLE_BY_FILL = new Map([
  ["#ff8a57", "brand-mark-circle"],
  ["#78b4ff", "brand-mark-square"],
  [SMILE_LIGHT, "brand-mark-ink"],
  [SMILE_DARK, "brand-mark-ink"],
]);

export function readMark(theme = "light") {
  return readFileSync(theme === "dark" ? MARK_DARK : MARK_LIGHT, "utf8");
}

/**
 * The mark as inline SVG for a generated page: the same geometry, the smile as a CSS
 * token, no ARIA (the wordmark beside it carries the reading). No CSS filter inverts it.
 */
export function inlineMark(svg = readMark()) {
  return svg
    .replace(
      /<svg[^>]*>/,
      '<svg class="brand-mark" viewBox="0 0 200 200" aria-hidden="true" focusable="false">',
    )
    .replaceAll(`fill="${SMILE_LIGHT}"`, 'fill="var(--brand-mark-ink)"')
    .replaceAll(`fill="${SMILE_DARK}"`, 'fill="var(--brand-mark-ink)"')
    .replaceAll('fill="#ff8a57"', 'fill="var(--brand-mark-circle)"')
    .replaceAll('fill="#78b4ff"', 'fill="var(--brand-mark-square)"');
}

/** The three shapes of the drawing with their attributes, in source order. */
export function markParts(svg = readMark()) {
  return [...svg.matchAll(/<(circle|rect|path)\b([^>]*)\/>/g)].map(([, tag, body]) => {
    const attrs = {};
    for (const [, name, value] of body.matchAll(/([a-z-]+)="([^"]*)"/g)) attrs[name] = value;
    const role = ROLE_BY_FILL.get(attrs.fill);
    if (role) attrs.fill = `var(--${role})`;
    return { tag, attrs };
  });
}

/** The checked-in module `@remo/ui` imports; generated so the drawing has one source. */
export function brandModule(svg = readMark()) {
  const parts = markParts(svg)
    .map(
      ({ tag, attrs }) =>
        `  { tag: "${tag}", attrs: { ${Object.entries(attrs)
          .map(([name, value]) => `${name}: ${JSON.stringify(value)}`)
          .join(", ")} } },`,
    )
    .join("\n");
  return `/**
 * Generated from docs/design/brand/remuka-mark.svg by scripts/brand-build.mjs.
 * Do not edit: change the source drawing and run \`pnpm brand:build\`.
 */
export const BRAND_MARK_VIEW_BOX = "0 0 200 200";

export interface BrandMarkPart {
  tag: "circle" | "rect" | "path";
  attrs: Record<string, string>;
}

export const BRAND_MARK_PARTS: readonly BrandMarkPart[] = [
${parts}
];
`;
}
