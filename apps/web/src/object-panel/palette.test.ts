import { describe, expect, it } from "vitest";
import {
  BOARD_COLORS,
  FILL_LEVELS,
  TONE_LEVELS,
  colorExtras,
  colorsForLevels,
} from "@remo/model";
import { enCore } from "../i18n/en-core";
import { ruCore } from "../i18n/ru-core";
import { colorName } from "./colorWindowData";
import { defaultStickerFill, noteFillChoices } from "./palette";

/**
 * Every swatch has a word (ADR-120).
 *
 * The palette is data in the model and the names are i18n keys `color.<hex>`; a colour
 * added to the model without a name would render as a circle nobody can describe, which
 * is the thing this rule exists to prevent.
 */
describe("the palette names", () => {
  const name = (table: Record<string, string>, hex: string) => table[`color.${hex.slice(1)}`];

  it("names every colour in both languages", () => {
    for (const hex of BOARD_COLORS) {
      expect(name(enCore as Record<string, string>, hex), hex).toBeTruthy();
      expect(name(ruCore as Record<string, string>, hex), hex).toBeTruthy();
    }
  });

  it("gives each colour its own word, so a name never means two shades", () => {
    const names = BOARD_COLORS.map((hex) => name(enCore as Record<string, string>, hex));
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("the rail's seven quick sticky fills", () => {
  it("uses the mockup order and values from the full properties palette", () => {
    const rail = noteFillChoices().map(({ hex }) => hex);
    expect(rail).toEqual(["#f4e0a8", "#c8e8d4", "#cddff8", "#f9d3cd", "#f3e8ff", "#ffdcc6", "#f3f1ec"]);
    const full = colorsForLevels(FILL_LEVELS).map(({ hex }) => hex);
    expect(full).toHaveLength(14);
    expect(full).toEqual(expect.arrayContaining(rail));
    expect([...colorExtras("note")]).toEqual(["white", "black"]);
  });

  it("marks exactly the default sheet: yellow at 100", () => {
    const marked = noteFillChoices().filter((color) => color.hex === defaultStickerFill());

    expect(marked).toHaveLength(1);
    expect(marked[0]).toMatchObject({ tone: "yellow", level: 100 });
    expect(defaultStickerFill()).toBe(TONE_LEVELS.yellow[100]);
  });

  it("names every swatch with the window's key", () => {
    for (const color of noteFillChoices()) {
      expect(color.key).toBe(`color.${color.hex.slice(1)}`);
      expect(enCore[color.key as keyof typeof enCore], color.hex).toBeTruthy();
      expect(ruCore[color.key as keyof typeof ruCore], color.hex).toBeTruthy();
    }
  });

  it("keeps the old sheet colour out of the grid, as Custom colour", () => {
    // The legacy #FFDD33 is the value ADR-120 shipped and ADR-127 stopped offering.
    expect(noteFillChoices().some((color) => color.hex === "#ffdd33")).toBe(false);
    expect(colorName("#ffdd33")).toEqual({ key: "color.own", detail: "#ffdd33" });
  });
});
