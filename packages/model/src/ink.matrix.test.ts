import { describe, expect, it } from "vitest";
import {
  CARD_WHITE,
  cardFillFor,
  COLOR_LEVELS,
  PREVIOUS_FILL_LEVELS,
  PREVIOUS_FILL_LEVELS_182,
  WIDGET_KINDS,
  type KindInk,
  type InkRole,
} from "./index";
import {
  FRAME_BODY_ALPHA,
  INK_LADDER,
  contrastRatio,
  groundOf,
  ink,
} from "./ink";

/**
 * Every part of every kind, on every fill, in both themes (ADR-273 §3.2).
 *
 * The painters may only reach ink through `groundOf` + `ink`; this matrix proves that what
 * those two return is readable for every combination the product can paint. A theme colour
 * used for content — the defect ADR-273 exists to remove — has no contrast on at least one
 * of these grounds, and the last test says so out loud.
 */

/** The canvas grounds of the two themes: `bg-canvas` is paper-cream-50 and neutral-900. */
const CANVAS = { light: "#fbf3df", dark: "#1e2136" } as const;

/** The light ladder is ink; this is the "theme ink" the old code used, kept for the negative case. */
const THEME_INK = "#1a1a1a";

/** Every fill a document may hold: the three rows, white paper and both older sets. */
function paletteFills(): string[] {
  const fills = [
    ...COLOR_LEVELS.map((colour) => colour.hex),
    CARD_WHITE,
    ...COLOR_LEVELS.map((colour) => cardFillFor(colour.hex)),
    ...Object.values(PREVIOUS_FILL_LEVELS_182).flatMap((row) => Object.values(row)),
    ...Object.values(PREVIOUS_FILL_LEVELS).flatMap((row) => Object.values(row)),
  ];
  return [...new Set(fills)];
}

/** The grounds a kind may paint on, decided by its declaration (ADR-273 §3.5). */
function groundsFor(kind: KindInk): string[] {
  const body = [
    groundOf({ container: "#fffdf8", containerAlpha: FRAME_BODY_ALPHA, canvas: CANVAS.light }),
    groundOf({ container: "#fffdf8", containerAlpha: FRAME_BODY_ALPHA, canvas: CANVAS.dark }),
  ];
  if (kind.ground === "canvas") return [CANVAS.light, CANVAS.dark];
  if (kind.ground === "container") return [...new Set([...body, ...paletteFills()])];
  return [...new Set([...paletteFills(), ...body])];
}

/** The same threshold the role declares, checked against the ink `ink()` returned. */
function readable(ground: string, role: InkRole): boolean {
  const ratio = contrastRatio(ink(ground, role), ground);
  if (role === "line") return ratio >= 1.25 && ratio <= 1.6;
  return ratio >= (role === "text" || role === "muted" ? 4.5 : 3);
}

describe("ink matrix: every kind × every fill × both themes × every role (ADR-273 §3.2)", () => {
  it("declares its ground and its roles for every kind", () => {
    for (const [type, kind] of Object.entries(WIDGET_KINDS)) {
      expect(kind.ink, type).toBeDefined();
      expect(kind.ink.roles.length, type).toBeGreaterThan(0);
      expect(["ownFill", "container", "canvas"], type).toContain(kind.ink.ground);
    }
  });

  it("holds the threshold for every part on every ground", () => {
    const failures: string[] = [];
    for (const [type, kind] of Object.entries(WIDGET_KINDS)) {
      for (const ground of groundsFor(kind.ink)) {
        for (const role of kind.ink.roles) {
          if (!readable(ground, role)) {
            failures.push(
              `${type} · ${role} on ${ground} = ${contrastRatio(ink(ground, role), ground).toFixed(2)}:1`,
            );
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("keeps the hairline band, not a heavy border, on every ground", () => {
    for (const ground of [...paletteFills(), CANVAS.light, CANVAS.dark]) {
      const ratio = contrastRatio(ink(ground, "line"), ground);
      expect(ratio, ground).toBeGreaterThanOrEqual(1.25);
      expect(ratio, ground).toBeLessThanOrEqual(1.6);
    }
  });

  it("fails the same check for a theme colour, which is why the matrix exists", () => {
    // The old painters used the theme's `textPrimary` for content. On the deeper fills it
    // is unreadable, so the assertion above would name the part and the ground.
    const unreadable = paletteFills().filter(
      (ground) => contrastRatio(THEME_INK, ground) < 4.5,
    );
    expect(unreadable.length).toBeGreaterThan(0);
    expect(INK_LADDER[0]).not.toBe(THEME_INK);
  });
});
