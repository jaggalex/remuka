/**
 * Cursors that are not a CSS keyword (ADR-265 §3.7, T18).
 *
 * The rotation cursor is a circular arrow with a paper edge, so it reads on the cream
 * board and on a dark sticky. The asset is a served SVG, not a stylesheet rule: a
 * cursor image cannot inherit `currentColor`, so the two colours live in the picture.
 * Hotspot is the centre (12, 12) of its 24 px grid.
 */
export const ROTATE_CURSOR = 'url("/cursors/rotate.svg") 12 12, crosshair';

/**
 * The overlay's cursor, in one place.
 *
 * A rotation handle wins over a connector port, and a kanban band wins over nothing:
 * the same priority the pointer machine applies before it decides what a press means.
 */
export function canvasCursor(input: {
  rotationHover: boolean;
  hoverAnchor: boolean;
  kanban: "grab" | "move" | undefined;
}): { cursor: string } | undefined {
  if (input.rotationHover) return { cursor: ROTATE_CURSOR };
  if (input.hoverAnchor) return { cursor: "crosshair" };
  return input.kanban ? { cursor: input.kanban } : undefined;
}
