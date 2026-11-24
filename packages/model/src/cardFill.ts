import { TONE_LEVELS, matchColor } from "./colorLevels";

/**
 * The fill of a kanban card that has no colour of its own (ADR-267 §2.1).
 *
 * A card reads its column, the way a status reads without reading words: "To do" is
 * white paper, "Doing" is yellow 300, "Done" is green 300. The colour is computed from
 * `column.accent` when the card is painted, so moving a card recolours it and nothing is
 * written to the document; a card's own `style.fillColor`, when someone chose one, wins
 * over this rule and survives a move.
 *
 * One rule for every accent, including the ones nobody meant as a palette tone:
 *  - an accent found in any row of the palette, or in one of the previous sets the colour
 *    window recognises, names its tone;
 *  - grey, `TODO_ACCENT` (`#595959`), the new column's default `#9ca3af` and any hex the
 *    palette does not know give white paper — a card is never left without a fill;
 *  - any other tone gives that tone's row 300. A row-600 accent changes only the column
 *    header: the card still gets the 300 fill, so the tone reads the same.
 *
 * The values are the palette's own, not tokens: a shared document cannot read a
 * stylesheet (ADR-127), and the export must paint what the screen paints.
 */
export const CARD_WHITE = "#ffffff";

export function cardFillFor(accent: string | null | undefined): string {
  const match = accent ? matchColor(accent) : null;
  if (!match || !match.exact || match.color.tone === "grey") return CARD_WHITE;
  return TONE_LEVELS[match.color.tone][300];
}
