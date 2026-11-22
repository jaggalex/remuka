import type { TextMarks } from "@remo/model";

/**
 * The CSS a clipboard fragment uses instead of tags (ADR-252 §3).
 *
 * A web page paints weight and slant in `style`, and so does Google Docs — whose whole
 * clipboard sits in a `font-weight:normal` wrapper. Reading the same two rules here keeps
 * the editor and a paste from disagreeing, and there is only one reader of `style`.
 */

/** A `style` attribute as a small map; the browser's CSSOM does the same job. */
export function styleOf(source: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!source) return out;
  for (const part of source.split(";")) {
    const colon = part.indexOf(":");
    if (colon < 0) continue;
    out[part.slice(0, colon).trim().toLowerCase()] = part
      .slice(colon + 1)
      .trim()
      .toLowerCase();
  }
  return out;
}

/** `font-size` in CSS pixels, or undefined when the style says nothing usable. */
export function sizeOf(style: Record<string, string>): number | undefined {
  const raw = style["font-size"];
  if (!raw) return undefined;
  const match = /^(\d+(?:\.\d+)?)\s*(px|pt|em|rem|%)?$/.exec(raw);
  if (!match) return undefined;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return undefined;
  switch (match[2]) {
    case "pt":
      return (value * 96) / 72;
    case "em":
    case "rem":
      return value * 16;
    case "%":
      return (value * 16) / 100;
    default:
      return value;
  }
}

/**
 * The marks a `style` attribute adds to or removes from the inherited ones.
 *
 * `font-weight:normal` really clears a bold parent: that is how Google Docs wraps its
 * whole clipboard, and believing it is the difference between a clean paste and an
 * entirely bold note. `text-decoration` is read the same way, and a link never keeps an
 * underline mark because the painter draws links underlined already.
 */
export function marksFromStyle(base: TextMarks, attributes: Record<string, string>): TextMarks {
  const style = styleOf(attributes.style);
  const next: TextMarks = { ...base };

  const weight = style["font-weight"];
  if (weight) {
    const numeric = Number(weight);
    const bold =
      weight === "bold" || weight === "bolder" || (Number.isFinite(numeric) && numeric >= 600);
    if (bold) next.bold = true;
    else if (weight === "normal" || weight === "lighter" || Number.isFinite(numeric)) {
      delete next.bold;
    }
  }

  const slant = style["font-style"];
  if (slant === "italic" || slant === "oblique") next.italic = true;
  else if (slant === "normal") delete next.italic;

  const decoration = `${style["text-decoration"] ?? ""} ${style["text-decoration-line"] ?? ""}`;
  if (style["text-decoration"] || style["text-decoration-line"]) {
    if (decoration.includes("underline")) next.underline = true;
    else delete next.underline;
    if (decoration.includes("line-through")) next.strike = true;
    else delete next.strike;
  }

  if (/mono/i.test(style["font-family"] ?? "")) next.code = true;
  return next;
}
