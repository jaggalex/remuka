/**
 * Repaint a room document from a previous tonal row to the current one (ADR-183, ADR-267).
 *
 * Pure: takes a `Y.Doc`, changes only values that are one of the previous fills, and
 * reports what it changed. `scripts/repaint-paper.mjs` loads and saves the rooms; this
 * module never touches the database, so it is tested without one.
 *
 * The table is both previous sets of `@remo/model` (`PREVIOUS_FILL_LEVELS_182` and
 * `PREVIOUS_FILL_LEVELS`) mapped straight to the current `TONE_LEVELS`, so one run takes a
 * room of any age to the palette of ADR-267. A value that is current again (the landing
 * page's 300 row) has no entry: there is nothing to repaint.
 * `paper-repaint.test.mjs` compares the table with the model.
 */
import { Y } from "./y.mjs";

/** Previous value → the current value of the same tone and level (ADR-267). */
export const PAPER_REPAINT = Object.freeze({
  "#efece8": "#f3f1ec",
  "#bfb9b1": "#cdc8c0",
  "#ffe07a": "#f4e0a8",
  "#ece2c8": "#f4e0a8",
  "#d8c79e": "#f2b94a",
  "#ffcd9e": "#ffdcc6",
  "#e2d2c4": "#ffdcc6",
  "#bca996": "#ff8a57",
  "#ffc6d9": "#f9d3cd",
  "#e8d6d3": "#f9d3cd",
  "#cdb0ab": "#ff8fbd",
  "#d9c9ff": "#f3e8ff",
  "#dcd8e2": "#f3e8ff",
  "#b9b1c9": "#c69bff",
  "#b5dcff": "#cddff8",
  "#d8dde3": "#cddff8",
  "#aab7c5": "#78b4ff",
  "#b9ecac": "#c8e8d4",
  "#dedfd4": "#c8e8d4",
  "#bcbfa9": "#85d965",
});

/** The style fields that hold a colour; a widget without one is left alone. */
export const COLOUR_FIELDS = Object.freeze(["fillColor", "strokeColor", "textColor", "color"]);

/** The paper value for a stored colour, or null when it is not a previous fill. */
export function paperFor(value) {
  if (typeof value !== "string") return null;
  return PAPER_REPAINT[value.trim().toLowerCase()] ?? null;
}

/**
 * Count — and with `apply` rewrite — every previous fill in the document.
 *
 * @returns {{ widgets: number, columns: number, fills: Array<{ id: string, from: string, to: string }> }}
 *   `fills` lists widget fill changes so the caller can update the `widgets` projection.
 */
export function repaintDocument(doc, { apply = false, origin = "paper-repaint" } = {}) {
  const result = { widgets: 0, columns: 0, fills: [] };
  const run = () => {
    const widgets = doc.getMap("widgets");
    widgets.forEach((widget, id) => {
      if (!widget || typeof widget !== "object" || widget instanceof Y.AbstractType) return;
      const style = widget.style;
      if (!style || typeof style !== "object") return;
      const next = { ...style };
      let changed = false;
      for (const field of COLOUR_FIELDS) {
        const paper = paperFor(style[field]);
        if (!paper) continue;
        next[field] = paper;
        changed = true;
        if (field === "fillColor") result.fills.push({ id, from: style[field], to: paper });
      }
      if (!changed) return;
      result.widgets += 1;
      if (apply) widgets.set(id, { ...widget, style: next });
    });

    doc.getMap("kanbans").forEach((kanban) => {
      if (!(kanban instanceof Y.Map)) return;
      const columns = kanban.get("columns");
      if (!(columns instanceof Y.Array)) return;
      for (const column of columns.toArray()) {
        if (!(column instanceof Y.Map)) continue;
        const paper = paperFor(column.get("accent"));
        if (!paper) continue;
        result.columns += 1;
        if (apply) column.set("accent", paper);
      }
    });
  };
  if (apply) doc.transact(run, origin);
  else run();
  return result;
}
