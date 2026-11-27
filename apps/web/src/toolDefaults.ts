import type { ConnectorRouting, ShapeKind } from "@remo/model";
import { NAMED_COLORS, TONE_LEVELS } from "@remo/model";
import { defaultStickerFill } from "./object-panel/palette";

/**
 * The variants the rail remembers for the next object (ADR-266 §10a).
 *
 * A tool's flyout is a choice, not a one-off: the person picked a note colour, a shape
 * kind or a line type, and the next object should look like it. This is browser
 * preference, not part of the document, so it lives in `localStorage` (ADR-123) and is
 * read through one module — the rail, the creation path and the connector defaults all
 * ask the same question and cannot drift.
 */

const STICKY = "remo.tool.sticky";
const SHAPE = "remo.tool.shape";
const CONNECTOR = "remo.tool.connector";

const SHAPE_KINDS: readonly ShapeKind[] = [
  "rectangle",
  "round_rectangle",
  "ellipse",
  "diamond",
  "triangle",
];
const ROUTINGS: readonly ConnectorRouting[] = ["straight", "elbow", "curved"];

/** Every fill a note may remember: the fourteen swatches, not White and Black. */
const STICKY_FILLS: readonly string[] = [
  ...[100, 300].flatMap((level) =>
    Object.values(TONE_LEVELS).map((row) => row[level as 100 | 300]),
  ),
  NAMED_COLORS.white,
  NAMED_COLORS.black,
];

/** The fill a new note takes: the last one picked here, else the model default. */
export function rememberedStickerFill(): string {
  let value: string | null = null;
  try {
    value = window.localStorage.getItem(STICKY);
  } catch {
    // A private window refuses storage; the model default still paints the note.
  }
  return value && STICKY_FILLS.includes(value) ? value : defaultStickerFill();
}

export function rememberStickerFill(fill: string): void {
  if (!STICKY_FILLS.includes(fill)) return;
  try {
    window.localStorage.setItem(STICKY, fill);
  } catch {
    // The choice still applies to this visit.
  }
}

/** The kind a new shape takes: the last one picked in the rail. */
export function rememberedShapeKind(): ShapeKind {
  let value: string | null = null;
  try {
    value = window.localStorage.getItem(SHAPE);
  } catch {
    // Same as a note: the default shape is past a refused storage.
  }
  return value && SHAPE_KINDS.includes(value as ShapeKind)
    ? (value as ShapeKind)
    : "rectangle";
}

export function rememberShapeKind(kind: ShapeKind): void {
  if (!SHAPE_KINDS.includes(kind)) return;
  try {
    window.localStorage.setItem(SHAPE, kind);
  } catch {
    // The choice still applies to this visit.
  }
}

/** The routing of a new connector: the last type chosen on the rail. */
export function rememberedRouting(): ConnectorRouting | null {
  let value: string | null = null;
  try {
    value = window.localStorage.getItem(CONNECTOR);
  } catch {
    // No stored line type: the connector falls back to its default.
  }
  return value && ROUTINGS.includes(value as ConnectorRouting)
    ? (value as ConnectorRouting)
    : null;
}

export function rememberRouting(routing: ConnectorRouting): void {
  if (!ROUTINGS.includes(routing)) return;
  try {
    window.localStorage.setItem(CONNECTOR, routing);
  } catch {
    // The choice still applies to this visit.
  }
}
