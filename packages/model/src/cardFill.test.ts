import { describe, expect, it } from "vitest";
import {
  PREVIOUS_FILL_LEVELS,
  PREVIOUS_FILL_LEVELS_182,
  TONES,
  TONE_LEVELS,
  type ColorLevel,
} from "./colorLevels";
import { CARD_WHITE, cardFillFor } from "./cardFill";

/**
 * The card colour rule of ADR-267 §2.1.
 *
 * The acceptance is a table over every value of every row, the new column's default and
 * an arbitrary hex: the rule is total, so no column accent can leave a card without a
 * fill, and a card's tone always reads the same whatever row the column accent came from.
 */
const LEVELS: ColorLevel[] = [100, 300, 600];

describe("a card without a colour of its own", () => {
  it("takes its column's row 300 for every palette value", () => {
    const expected: Record<string, string> = {
      grey: CARD_WHITE,
      yellow: "#f2b94a",
      orange: "#ff8a57",
      pink: "#ff8fbd",
      violet: "#c69bff",
      blue: "#78b4ff",
      green: "#85d965",
    };
    for (const tone of TONES) {
      for (const level of LEVELS) {
        // A row-600 accent is a header colour; the card still gets the row-300 fill.
        expect(cardFillFor(TONE_LEVELS[tone][level]), `${tone} ${level}`).toBe(expected[tone]);
      }
    }
  });

  it("recognises both previous sets the colour window knows", () => {
    for (const table of [PREVIOUS_FILL_LEVELS_182, PREVIOUS_FILL_LEVELS]) {
      for (const tone of TONES) {
        for (const level of [100, 300] as const) {
          const old = table[tone][level];
          if (old === TONE_LEVELS[tone][level]) continue;
          expect(cardFillFor(old), `${tone} ${level} ${old}`).toBe(
            tone === "grey" ? CARD_WHITE : TONE_LEVELS[tone][300],
          );
        }
      }
    }
  });

  it("makes grey columns white, as the mockup's To do column is", () => {
    expect(cardFillFor(TONE_LEVELS.grey[100])).toBe(CARD_WHITE);
    expect(cardFillFor(TONE_LEVELS.grey[300])).toBe(CARD_WHITE);
    expect(cardFillFor(TONE_LEVELS.grey[600])).toBe(CARD_WHITE);
  });

  it("gives white paper for the accents that are not a tone", () => {
    // The template's "To do", the new column's default and anything hand-written.
    expect(cardFillFor("#595959")).toBe(CARD_WHITE);
    expect(cardFillFor("#9ca3af")).toBe(CARD_WHITE);
    expect(cardFillFor("#123456")).toBe(CARD_WHITE);
    expect(cardFillFor("")).toBe(CARD_WHITE);
    expect(cardFillFor(null)).toBe(CARD_WHITE);
    expect(cardFillFor(undefined)).toBe(CARD_WHITE);
  });

  it("ignores case and stray whitespace, as the colour window does", () => {
    expect(cardFillFor("#FF8A57")).toBe("#ff8a57");
    expect(cardFillFor(" #F2B94A ")).toBe("#f2b94a");
  });
});
