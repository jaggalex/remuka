import { expandSelection } from "@remo/agent-plan/model-context";
export { readingOrder, expandSelection, buildSelectionSource } from "@remo/agent-plan/model-context";

const FRAME_PAD = 24;
const FRAME_HEADER = 44;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 10) / 10 : fallback;
}

/** The same source as one stored input row: JSON text, never the board itself. */
export function selectionInput(source) {
  return {
    source: "selection",
    name: "selection",
    kind: "text",
    content: JSON.stringify(source),
    bytes: source.counts.chars,
    chars: source.counts.chars,
    truncated: source.truncated === true,
    truncation_code: source.truncationCode ?? null,
  };
}

/** Read a stored selection row back; a broken row is "no selection", not a crash. */
export function readSelectionInput(input) {
  if (!input?.content) return null;
  try {
    const parsed = JSON.parse(input.content);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/** The inner rectangle of a frame: below its title band, inside its padding. */
export function frameArea(frame) {
  return {
    x: frame.x - frame.width / 2 + FRAME_PAD,
    y: frame.y - frame.height / 2 + FRAME_HEADER,
    width: Math.max(0, frame.width - FRAME_PAD * 2),
    height: Math.max(0, frame.height - FRAME_HEADER - FRAME_PAD),
  };
}

/**
 * The movable set of a tidy, split by where it lives.
 *
 * - each selected frame is a group laid out **inside** itself (ADR-143);
 * - selected free objects form one group that may get block frames;
 * - a selected child of an unselected frame stays put: tidy does not detach an object
 *   from a container the person did not select;
 * - connectors are never placed.
 */
export function tidyGroups(ydoc, selectionIds) {
  const widgets = ydoc.getMap("widgets");
  const expanded = expandSelection(ydoc, selectionIds);
  const byId = new Map(expanded.objects.map((object) => [object.id, object]));
  const frameIds = expanded.objects
    .filter((object) => object.type === "frame")
    .map((object) => object.id);
  const frameSet = new Set(frameIds);
  const groups = [];
  const moved = new Set();

  const parentOf = (id) => widgets.get(id)?.parentId ?? null;
  const insideSelectedFrame = (id) => {
    let parent = parentOf(id);
    const seen = new Set();
    while (parent && !seen.has(parent)) {
      if (frameSet.has(parent)) return true;
      seen.add(parent);
      parent = parentOf(parent);
    }
    return false;
  };

  for (const frameId of frameIds) {
    const frameWidget = widgets.get(frameId);
    if (!frameWidget) continue;
    const items = expanded.objects.filter(
      (object) => object.id !== frameId && insideSelectedFrame(object.id),
    );
    const area = frameArea({
      x: finite(frameWidget.x),
      y: finite(frameWidget.y),
      width: finite(frameWidget.width),
      height: finite(frameWidget.height),
    });
    groups.push({
      kind: "frame",
      frameId,
      frame: {
        id: frameId,
        x: finite(frameWidget.x),
        y: finite(frameWidget.y),
        width: finite(frameWidget.width),
        height: finite(frameWidget.height),
      },
      area,
      items: items.map((item) => ({ ...item, containerId: frameId })),
    });
    for (const item of items) moved.add(item.id);
  }

  // Selected children of an **unselected** frame are still ours to move: they stay
  // inside their parent. Tidy them inside that frame instead of skipping everything,
  // which used to end in TIDY_EMPTY when a marquee started inside a big frame.
  const implicitFrames = new Set();
  for (const object of expanded.objects) {
    if (object.type === "frame" || moved.has(object.id)) continue;
    const parent = object.parentId;
    if (!parent || frameSet.has(parent)) continue;
    const frame = widgets.get(parent);
    if (frame?.type === "frame") implicitFrames.add(parent);
  }
  for (const frameId of implicitFrames) {
    const frameWidget = widgets.get(frameId);
    if (!frameWidget) continue;
    const items = expanded.objects.filter(
      (object) =>
        object.id !== frameId && object.parentId === frameId && !moved.has(object.id),
    );
    if (!items.length) continue;
    groups.push({
      kind: "frame",
      frameId,
      frame: {
        id: frameId,
        x: finite(frameWidget.x),
        y: finite(frameWidget.y),
        width: finite(frameWidget.width),
        height: finite(frameWidget.height),
      },
      area: frameArea({
        x: finite(frameWidget.x),
        y: finite(frameWidget.y),
        width: finite(frameWidget.width),
        height: finite(frameWidget.height),
      }),
      items: items.map((item) => ({ ...item, containerId: frameId })),
    });
    for (const item of items) moved.add(item.id);
  }

  const free = expanded.objects.filter((object) => {
    if (object.type === "frame") return false;
    if (moved.has(object.id)) return false;
    // Anything still parented is inside a frame we did not select and that had no
    // selected children: leave it alone.
    return !object.parentId;
  });

  const skipped = expanded.objects.filter(
    (object) =>
      object.type !== "frame" &&
      !moved.has(object.id) &&
      object.parentId &&
      !frameSet.has(object.parentId),
  );

  if (free.length) {
    for (const item of free) moved.add(item.id);
    const bounds = free.reduce(
      (acc, item) => ({
        minX: Math.min(acc.minX, item.x - item.width / 2),
        minY: Math.min(acc.minY, item.y - item.height / 2),
        maxX: Math.max(acc.maxX, item.x + item.width / 2),
        maxY: Math.max(acc.maxY, item.y + item.height / 2),
      }),
      { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
    );
    groups.push({
      kind: "free",
      frameId: null,
      frame: null,
      area: null,
      origin: { x: bounds.minX, y: bounds.minY },
      items: free,
    });
  }

  // Everything that is not ours to move is an obstacle, including a selected frame
  // when the free group is laid out beside it.
  const movable = new Set(groups.flatMap((group) => group.items.map((item) => item.id)));
  const foreign = [];
  widgets.forEach((widget, id) => {
    const key = String(id);
    if (widget.type === "connector" || movable.has(key)) return;
    if (insideSelectedFrame(key)) return;
    // The parent of an implicit group is its area, not an obstacle inside itself.
    if (implicitFrames.has(key)) return;
    foreign.push({
      id: key,
      x: finite(widget.x),
      y: finite(widget.y),
      width: finite(widget.width),
      height: finite(widget.height),
    });
  });

  return {
    groups,
    moved: [...moved],
    free: free.map((item) => item.id),
    skipped: skipped.map((item) => item.id),
    foreign,
    frames: frameIds,
    expanded,
  };
}
