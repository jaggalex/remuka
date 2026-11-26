import type { Widget } from "./types";
import { layerKey } from "./stacking.mjs";

export { layerKey, rankOf, PAINT_RANK } from "./stacking.mjs";

/**
 * How many frames each widget sits inside (ADR-242). A cycle in bad data stops the walk
 * instead of looping.
 */
export function nestingDepth(widgets: readonly Widget[]): Map<string, number> {
  const parentOf = new Map(widgets.map((widget) => [widget.id, widget.parentId ?? null]));
  const depth = new Map<string, number>();
  for (const widget of widgets) {
    let level = 0;
    let current = widget.parentId ?? null;
    const seen = new Set<string>([widget.id]);
    while (current && parentOf.has(current) && !seen.has(current)) {
      seen.add(current);
      level += 1;
      current = parentOf.get(current) ?? null;
    }
    depth.set(widget.id, level);
  }
  return depth;
}

/** An extra slot preserves insertion order between adjacent floating-point heights. */
export function compareLayers(a: Widget, b: Widget): number {
  return layerKey(a) - layerKey(b) || (a.zTie ?? 0) - (b.zTie ?? 0);
}

/** Two peers may create at the same height before exchanging their Yjs updates.
 * Explicit ties use the stable object id; unlayered legacy siblings retain document order.
 */
export function breakLayerTie(a: Widget, b: Widget): number {
  if (a.z === undefined || b.z === undefined) return Number(a.z !== undefined) - Number(b.z !== undefined);
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Widgets in paint order: first is furthest back. Equal layer keys are broken by
 * nesting, so a section inside another is painted after its parent and is never hidden
 * under the parent's plate (ADR-242). Otherwise the document order stands.
 */
export function paintOrder(widgets: Widget[]): Widget[] {
  const depth = nestingDepth(widgets);
  return [...widgets].sort(
    (a, b) => compareLayers(a, b) || (depth.get(a.id) ?? 0) - (depth.get(b.id) ?? 0) || breakLayerTie(a, b),
  );
}
