/**
 * A selection read as **source** (ADR-143).
 *
 * Two readers share this module. The task surface turns a selection into what a model
 * may see: plain texts, kinds, boxes and the lines between selected objects, ordered
 * top-down and left-right. The tidy runner needs the same expansion plus the frame a
 * block is laid out inside. One expansion means the preview, the prompt and the plan
 * cannot disagree about what "the selection" is.
 *
 * Everything here is data. A note that says "ignore previous instructions" is a string
 * with a coordinate, never an instruction (ADR-142 "Untrusted content").
 */
import { SELECTION_LIMITS } from "./limits.mjs";

function textOf(texts, widget) {
  const editable = texts?.get?.(String(widget.id));
  const value =
    editable && typeof editable.toString === "function"
      ? editable.toString()
      : widget.title ?? widget.content ?? "";
  return String(value ?? "");
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 10) / 10 : fallback;
}

function tableOf(widget) {
  if (widget.layout?.kind !== "table") return null;
  const spans = Array.isArray(widget.layout.spans)
    ? widget.layout.spans
        .map((span) => ({
          rowId: String(span?.rowId ?? ""),
          columnId: String(span?.columnId ?? ""),
          rowSpan: Math.max(1, Math.round(Number(span?.rowSpan) || 1)),
          columnSpan: Math.max(1, Math.round(Number(span?.columnSpan) || 1)),
        }))
        .filter((span) => span.rowId && span.columnId)
    : [];
  return {
    active: widget.layout.active !== false,
    columns: Array.isArray(widget.layout.columns)
      ? widget.layout.columns.map((axis) => ({
          id: String(axis?.id ?? ""),
          title: String(axis?.title ?? ""),
        }))
      : [],
    rows: Array.isArray(widget.layout.rows)
      ? widget.layout.rows.map((axis) => ({
          id: String(axis?.id ?? ""),
          title: String(axis?.title ?? ""),
        }))
      : [],
    ...(spans.length ? { spans } : {}),
  };
}

function cellOf(widget) {
  const rowId = widget.cell?.rowId;
  const columnId = widget.cell?.columnId;
  return rowId && columnId
    ? { rowId: String(rowId), columnId: String(columnId) }
    : null;
}

function snapshot(widget, texts) {
  const table = tableOf(widget);
  const cell = cellOf(widget);
  return {
    id: String(widget.id),
    type: String(widget.type),
    text: textOf(texts, widget).trim(),
    x: finite(widget.x),
    y: finite(widget.y),
    width: finite(widget.width),
    height: finite(widget.height),
    parentId: widget.parentId ? String(widget.parentId) : null,
    groupId: widget.groupId ? String(widget.groupId) : null,
    locked: widget.locked === true,
    ...(table ? { table } : {}),
    ...(cell ? { cell } : {}),
  };
}

/** Top-down, then left-right: the order a person reads a board (ADR-143). */
export function readingOrder(a, b) {
  if (Math.abs(a.y - b.y) > 0.5) return a.y - b.y;
  if (Math.abs(a.x - b.x) > 0.5) return a.x - b.x;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Groups are expanded to their members and frames to everything they contain.
 *
 * A group is a selection helper: selecting one member means the group. A frame is a
 * container: selecting it means its contents. The result is deduplicated, because a
 * selected frame and a selected child name the same object twice.
 */
export function expandSelection(ydoc, selectionIds) {
  const widgets = ydoc.getMap("widgets");
  const texts = ydoc.getMap("texts");
  const requested = Array.isArray(selectionIds) ? selectionIds.map(String) : [];
  const groups = new Set();
  for (const id of requested) {
    const widget = widgets.get(id);
    if (widget?.groupId) groups.add(String(widget.groupId));
  }

  const chosen = new Set();
  const add = (id) => {
    const widget = widgets.get(id);
    if (!widget) return;
    if (widget.type === "connector") return;
    chosen.add(String(id));
  };
  for (const id of requested) add(id);
  if (groups.size) {
    widgets.forEach((widget, id) => {
      if (widget.groupId && groups.has(String(widget.groupId))) add(id);
    });
  }

  // Frames own their contents: selecting a frame selects the whole frame, not its
  // chrome. Walk the parent map rather than trusting a child list, so a malformed
  // board cannot hide an object from the expansion.
  const selectedFrames = [...chosen].filter((id) => widgets.get(id)?.type === "frame");
  if (selectedFrames.length) {
    const frameSet = new Set(selectedFrames);
    widgets.forEach((widget, id) => {
      let parent = widget.parentId ? String(widget.parentId) : null;
      const seen = new Set();
      while (parent && !seen.has(parent)) {
        if (frameSet.has(parent)) {
          if (widget.type !== "connector") chosen.add(String(id));
          break;
        }
        seen.add(parent);
        parent = widgets.get(parent)?.parentId ?? null;
      }
    });
  }

  const objects = [];
  chosen.forEach((id) => {
    const widget = widgets.get(id);
    if (widget) objects.push(snapshot(widget, texts));
  });
  objects.sort(readingOrder);

  const connectors = [];
  const chosenIds = new Set(objects.map((object) => object.id));
  widgets.forEach((widget, id) => {
    if (widget.type !== "connector") return;
    const from = widget.start?.item ? String(widget.start.item) : "";
    const to = widget.end?.item ? String(widget.end.item) : "";
    if (from && to && chosenIds.has(from) && chosenIds.has(to)) {
      connectors.push({ id: String(id), from, to });
    }
  });

  return {
    objects,
    connectors,
    frames: objects.filter((object) => object.type === "frame").map((object) => object.id),
    groups: [...groups],
  };
}

function cutText(text, remaining) {
  if (text.length <= remaining) return { text, cut: false };
  if (remaining <= 0) return { text: "", cut: true };
  const slice = text.slice(0, remaining);
  const boundary = Math.max(slice.lastIndexOf("\n"), slice.lastIndexOf(" "));
  const kept = (boundary > remaining * 0.6 ? slice.slice(0, boundary) : slice).trimEnd();
  return { text: kept, cut: true };
}

/**
 * What a model may see of a selection: at most fifty objects and twenty thousand
 * characters, empty texts and repeated texts dropped, the tail cut and reported.
 */
export function buildSelectionSource(ydoc, selectionIds, limits = SELECTION_LIMITS) {
  const expanded = expandSelection(ydoc, selectionIds);
  const seenTexts = new Set();
  const objects = [];
  const texts = [];
  let chars = 0;
  let empty = 0;
  let duplicates = 0;
  let truncated = false;

  for (const object of expanded.objects) {
    if (objects.length >= limits.objects) {
      truncated = true;
      break;
    }
    const text = object.text.replace(/\s+/g, " ").trim();
    if (!text) {
      empty += 1;
      objects.push({ ...object, text: "" });
      continue;
    }
    if (seenTexts.has(text)) {
      duplicates += 1;
      continue;
    }
    seenTexts.add(text);
    const remaining = limits.chars - chars;
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    const cut = cutText(text, remaining);
    chars += cut.text.length;
    if (cut.cut) truncated = true;
    objects.push({ ...object, text: cut.text });
    texts.push(cut.text);
    if (cut.cut) break;
  }

  return {
    objects,
    // The movable set is the whole expansion, not the model's de-duplicated view: an
    // empty note or a repeated sentence is still an object tidy may move (ADR-143).
    allowedIds: expanded.objects.map((object) => object.id),
    texts,
    connectors: expanded.connectors,
    frames: expanded.objects
      .filter((object) => object.type === "frame")
      .map((object) => object.id),
    groups: expanded.groups,
    counts: {
      selected: Array.isArray(selectionIds) ? selectionIds.length : 0,
      expanded: expanded.objects.length,
      included: objects.length,
      texts: texts.length,
      connectors: expanded.connectors.length,
      chars,
      empty,
      duplicates,
      frames: expanded.objects.filter((object) => object.type === "frame").length,
      groups: expanded.groups.length,
    },
    truncated,
    ...(truncated ? { truncationCode: "SELECTION_TRUNCATED" } : {}),
  };
}


export function selectionTexts(ydoc, ids) {
  const widgets = ydoc.getMap("widgets");
  const texts = ydoc.getMap("texts");
  const found = [];
  for (const id of Array.isArray(ids) ? ids.slice(0, 20) : []) {
    const widget = widgets.get(String(id));
    if (!widget) continue;
    const text = texts.get(String(id))?.toString() ?? widget.title ?? widget.content ?? "";
    if (!String(text).trim()) continue;
    found.push({ id: widget.id, type: widget.type, text: String(text).slice(0, 200) });
  }
  return found;
}


export const SNAPSHOT_LIMITS = Object.freeze({
  /** Objects described to the model. A larger board is reported as truncated. */
  objects: 200,
  frames: 50,
  kanbans: 20,
  columns: 12,
});

function snapshotObject(widget) {
  if (!widget || typeof widget !== "object" || !widget.id || !widget.type) return null;
  return {
    id: String(widget.id),
    type: String(widget.type),
    x: finite(widget.x),
    y: finite(widget.y),
    width: finite(widget.width),
    height: finite(widget.height),
    ...(widget.parentId ? { parentId: String(widget.parentId) } : {}),
    ...(widget.type === "connector" && widget.start?.item && widget.end?.item
      ? { from: String(widget.start.item), to: String(widget.end.item) }
      : {}),
  };
}

function columnIds(kanban) {
  const columns = kanban?.get?.("columns");
  if (!columns) return [];
  const list = typeof columns.toArray === "function" ? columns.toArray() : [];
  return list
    .map((column) => String(column?.get?.("id") ?? ""))
    .filter(Boolean)
    .slice(0, SNAPSHOT_LIMITS.columns);
}

/**
 * The smallest board description that still lets a plan be placed: ids, kinds, boxes,
 * frames and kanban column ids. Deliberately no titles, text, comments, tags or people.
 */
export function boardSnapshot(ydoc) {
  const widgets = ydoc.getMap("widgets");
  const kanbanMap = ydoc.getMap("kanbans");
  const objects = [];
  const frames = [];
  const kanbans = [];
  widgets.forEach((widget) => {
    const item = snapshotObject(widget);
    if (!item) return;
    if (objects.length < SNAPSHOT_LIMITS.objects) objects.push(item);
    if (item.type === "frame" && frames.length < SNAPSHOT_LIMITS.frames) frames.push(item.id);
    if (item.type === "kanban" && kanbans.length < SNAPSHOT_LIMITS.kanbans) {
      kanbans.push({ id: item.id, columns: columnIds(kanbanMap.get(item.id)) });
    }
  });
  objects.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    objects,
    frames,
    kanbans,
    counts: {
      objects: widgets.size,
      described: objects.length,
      truncated: widgets.size > objects.length,
    },
  };
}
