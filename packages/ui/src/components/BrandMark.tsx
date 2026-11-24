import type { CSSProperties } from "react";
import { BRAND_MARK_PARTS, BRAND_MARK_VIEW_BOX } from "../brand/brandMark.generated";
import { cx } from "./util";

export interface BrandMarkProps {
  /** The drawing's edge in pixels; the room header uses 24 (spec/character.md §3.8). */
  size?: number;
  /** The product name beside the mark, for the landing and sign-in header. */
  wordmark?: string;
  /** An accessible name for the mark alone; without it the mark is decorative. */
  label?: string;
  className?: string;
}

/**
 * The one product mark (ADR-272). Geometry comes from `docs/design/brand/remuka-mark.svg`
 * through a generated module, and every fill is a role: the smile is `brand-mark-ink`, so
 * the theme changes it without a CSS filter, and the circle and square never change.
 */
export function BrandMark({ size = 30, wordmark, label, className }: BrandMarkProps) {
  const a11y = label
    ? { role: "img" as const, "aria-label": label }
    : { "aria-hidden": true as const };
  return (
    <span
      className={cx("rm-brand", className)}
      style={{ "--rm-brand-size": `${size}px` } as CSSProperties}
    >
      <svg
        className="rm-brand-mark"
        width={size}
        height={size}
        viewBox={BRAND_MARK_VIEW_BOX}
        focusable="false"
        {...a11y}
      >
        {BRAND_MARK_PARTS.map((part, index) =>
          part.tag === "circle" ? (
            <circle key={index} {...part.attrs} />
          ) : part.tag === "rect" ? (
            <rect key={index} {...part.attrs} />
          ) : (
            <path key={index} {...part.attrs} />
          ),
        )}
      </svg>
      {wordmark && <span className="rm-brand-word">{wordmark}</span>}
    </span>
  );
}
