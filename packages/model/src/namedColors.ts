/**
 * Named values beside the tonal grid (ADR-140).
 *
 * White, black and transparency are not rungs of the 7 × 3 tonal ladder: they are the
 * values a person asks for by name, so each is one chip with one word rather than a
 * column or a row. They stay in the model beside `colorLevels.ts` because the document
 * stores a value, not a token name: a shared board must paint the same colour in a client
 * that cannot read our stylesheet.
 *
 * A role takes only the named values it can paint, in the order the window (and the rail
 * for a note) draws them. There is no second list: both surfaces read `colorExtras(role)`,
 * and `namedColors.test.ts` fails if a role starts offering a value its painter cannot use.
 */
export type NamedColorRole = "note" | "fill" | "stroke" | "text";

/**
 * The named values and what a widget stores for them.
 *
 * Black is true black (ADR-281). The old palette called `#1a1a1a` "Black", and that value
 * was also the near-black `readableInk` wrote as an *automatic* default; ADR-273 makes it
 * read as Auto, so a board that carries it keeps its look, while the Black chip must stay
 * a colour the person chose. White is unchanged; a board already storing `#1a1a1a` is
 * never rewritten (ADR-127 forbids a migration).
 */
export const NAMED_COLORS = {
  white: "#ffffff",
  black: "#000000",
  none: "transparent",
} as const;

export type NamedColorId = keyof typeof NAMED_COLORS;

/**
 * The named values each role offers, in drawing order.
 *
 * A note has no transparency: its sheet is the object, and an invisible note would be a
 * lost object. A fill may be transparent; a stroke may be "None"; text offers the two
 * solid inks beside the Auto/Dark/White control already present in the window.
 */
export const COLOR_EXTRAS = {
  note: ["white", "black"],
  fill: ["white", "black", "none"],
  stroke: ["black", "none"],
  text: ["black", "white"],
} as const satisfies Record<NamedColorRole, readonly NamedColorId[]>;

/** The one list a surface draws for a role. */
export function colorExtras(role: NamedColorRole): readonly NamedColorId[] {
  return COLOR_EXTRAS[role];
}

/** The value a named chip writes to the document. */
export function namedColorValue(id: NamedColorId): string {
  return NAMED_COLORS[id];
}
