/**
 * Generated from docs/design/brand/remuka-mark.svg by scripts/brand-build.mjs.
 * Do not edit: change the source drawing and run `pnpm brand:build`.
 */
export const BRAND_MARK_VIEW_BOX = "0 0 200 200";

export interface BrandMarkPart {
  tag: "circle" | "rect" | "path";
  attrs: Record<string, string>;
}

export const BRAND_MARK_PARTS: readonly BrandMarkPart[] = [
  { tag: "circle", attrs: { cx: "53", cy: "48", r: "37", fill: "var(--brand-mark-circle)" } },
  { tag: "rect", attrs: { x: "111", y: "12", width: "72", height: "72", rx: "12", fill: "var(--brand-mark-square)" } },
  { tag: "path", attrs: { d: "M30.02,106 H169.98 A12,12 0 0 1 181.81,120.03 A83,83 0 0 1 18.19,120.03 A12,12 0 0 1 30.02,106 Z", fill: "var(--brand-mark-ink)" } },
];
