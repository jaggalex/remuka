/** Widget anchors use x/y for local fractions; point anchors use them for world coordinates.
 * Legacy widget rows have null coordinates and require no migration. */
export function commentAnchor(input) {
  if (input?.kind === "widget" && typeof input.widgetId === "string" && input.widgetId) {
    if (input.fx === undefined && input.fy === undefined) return { kind: "widget", widgetId: input.widgetId };
    if ([input.fx, input.fy].every(value => Number.isFinite(value) && value >= 0 && value <= 1)) {
      return { kind: "widget", widgetId: input.widgetId, fx: input.fx, fy: input.fy };
    }
  }
  if (input?.kind === "point" && Number.isFinite(input.x) && Number.isFinite(input.y)) {
    return { kind: "point", x: input.x, y: input.y };
  }
  return null;
}

export function rowAnchor(row) {
  if (row.anchor_kind === "point") return { kind: "point", x: row.x, y: row.y };
  return { kind: "widget", widgetId: row.widget_id, ...(row.x != null && row.y != null && { fx: row.x, fy: row.y }) };
}

export function anchorValues(anchor) {
  return anchor.kind === "widget" ? ["widget", anchor.widgetId, anchor.fx ?? null, anchor.fy ?? null]
    : ["point", null, anchor.x, anchor.y];
}
