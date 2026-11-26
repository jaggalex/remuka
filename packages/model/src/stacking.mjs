/** Native ESM so browser commands and the Node sync service use the same layer model. */
export const PAINT_RANK = Object.freeze({
  frame: 0, kanban: 1, shape: 2, image: 2, unsupported: 2, connector: 3,
  stamp: 4, sticky_note: 5, group: 5, card: 6, timer: 7, text: 9,
});

export function rankOf(widget) {
  return Object.hasOwn(PAINT_RANK, widget.type) ? PAINT_RANK[widget.type] : 5;
}

export function layerKey(widget) {
  return widget.z ?? rankOf(widget) * 1000;
}

/** The highest existing layer, including legacy type-based layers (zero on an empty board). */
export function topZ(board) {
  let highest = -Infinity;
  for (const widget of board.widgets.values()) highest = Math.max(highest, layerKey(widget));
  return highest === -Infinity ? 0 : highest;
}

function freeFrame(widget) {
  return widget.type === "frame" && (widget.layout?.kind !== "table" || widget.layout.active === false);
}

// Room membership uses the centre of a free object (ADR-242). Cards in a kanban
// have placeholder coordinates; their parent matrix represents them on the canvas.
function coveredBy(frame, item) {
  if (freeFrame(item) || (item.type === "card" && item.parentId)) return false;
  const dx = item.x - frame.x;
  const dy = item.y - frame.y;
  const angle = (frame.rotation ?? 0) * Math.PI / 180;
  const x = dx * Math.cos(angle) + dy * Math.sin(angle);
  const y = dy * Math.cos(angle) - dx * Math.sin(angle);
  return Math.abs(x) <= frame.width / 2 && Math.abs(y) <= frame.height / 2;
}

/**
 * Assign fresh keys to a batch already in its source paint order. A free frame can
 * impose an upper boundary on the items beneath it in that same batch. Fill the gap
 * without moving any existing item, including manually raised or locked ones.
 */
export function creationLayers(board, ordered) {
  const result = new Map();
  let previous = topZ(board);
  const existing = ordered.some(freeFrame) ? [...board.widgets.values()] : [];
  const ceilings = new Array(ordered.length);
  let ceiling = Infinity;
  for (let i = ordered.length - 1; i >= 0; i--) {
    const item = ordered[i];
    if (freeFrame(item)) {
      for (const old of existing) {
        if (coveredBy(item, old)) ceiling = Math.min(ceiling, layerKey(old));
      }
    }
    ceilings[i] = ceiling;
  }
  let start = 0;
  while (start < ordered.length) {
    const upper = ceilings[start];
    let end = start + 1;
    while (end < ordered.length && ceilings[end] === upper) end++;
    if (upper === Infinity) {
      let tie = 0;
      for (let i = start; i < end; i++) {
        const next = previous + 1;
        if (next === previous) {
          if (!tie) tie = highestTie(board, previous);
          result.set(ordered[i].id, { z: previous, zTie: ++tie });
        } else {
          result.set(ordered[i].id, { z: next });
        }
        previous = next;
      }
    } else {
      let lower = -Infinity;
      for (const old of existing) {
        const key = layerKey(old);
        if (key < upper && key > lower) lower = key;
      }
      const count = end - start;
      if (lower === -Infinity) lower = upper - count - 1;
      const step = (upper - lower) / (count + 1);
      // Doubles eventually have no room between adjacent heights. Keep the whole
      // batch at the lower height, after its old occupants and below the covered item.
      let last = lower;
      let space = true;
      for (let i = 1; i <= count; i++) {
        const z = lower + step * i;
        if (!(last < z && z < upper)) { space = false; break; }
        last = z;
      }
      let tie = space ? 0 : highestTie(board, lower);
      for (let i = start; i < end; i++) {
        const z = lower + step * (i - start + 1);
        result.set(ordered[i].id, space ? { z } : { z: lower, zTie: ++tie });
      }
    }
    start = end;
  }
  return result;
}

function highestTie(board, z) {
  let highest = 0;
  for (const widget of board.widgets.values()) {
    if (layerKey(widget) === z) highest = Math.max(highest, widget.zTie ?? 0);
  }
  return highest;
}

/** Recreating a copied object discards its old tie-break value. */
export function withLayer(widget, placement) {
  const { zTie: oldTie, ...fields } = widget;
  return { ...fields, ...placement };
}

/** Insert inside the caller's Yjs transaction. Restoring a snapshot bypasses this. */
export function insertNewWidget(widgets, widget) {
  const placement = creationLayers({ widgets }, [widget]).get(widget.id);
  widgets.set(widget.id, withLayer(widget, placement));
}
