import { boxOf } from "@remo/canvas";
import {
  cornerPoints,
  resizedBox,
  type ResizeCorner,
  type ResizeOptions,
} from "./canvasGeometry";
import {
  isRotatable,
  localAxesPoint,
  localRectOf,
  rotateVector,
  rotatedBounds,
  rotationOf,
  selectionCentre,
  type Rect,
  type Vec2,
  type Widget,
} from "@remo/model";

/**
 * The selection's rotation frame, in one place (ADR-271, T18, ADR-283).
 *
 * A turned object has a frame of its own: its stored box in its own axes. A block has
 * the axis-aligned box around everything selected. Both the painter and the gesture
 * machine read this one frame, so the handle is drawn where it can be grabbed.
 */
export const ROTATE_STEM = 14;
export const ROTATE_RADIUS = 5;

export interface RotationFrame {
  /** The single turned object whose own axes the frame follows; absent for a block. */
  widget?: Widget;
  /** The pivot of a turn: the object's centre or the block's centre. */
  centre: Vec2;
  /** The frame's box: local axes for one turned object, world axes otherwise. */
  box: Rect;
  /** The frame's rotation; 0 for a block and for a straight object. */
  angle: number;
}

export function rotationFrame(members: readonly Widget[]): RotationFrame | null {
  if (!members.length) return null;
  if (members.length === 1) {
    const widget = members[0]!;
    const angle = rotationOf(widget);
    if (angle !== 0) {
      return {
        widget,
        centre: { x: widget.x, y: widget.y },
        box: localRectOf(widget),
        angle,
      };
    }
  }
  const centre = selectionCentre(members);
  if (!centre) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const widget of members) {
    const box = rotatedBounds(widget);
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.height);
  }
  return {
    centre,
    box: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
    angle: 0,
  };
}

/** A point of the frame's axes in the world. */
export function framePoint(frame: RotationFrame, local: Vec2): Vec2 {
  if (!frame.angle) return { x: local.x, y: local.y };
  const turned = rotateVector(local, frame.angle);
  return { x: frame.centre.x + turned.x, y: frame.centre.y + turned.y };
}

/** A world point in the frame's axes. */
export function frameLocal(frame: RotationFrame, world: Vec2): Vec2 {
  if (!frame.angle) return { x: world.x, y: world.y };
  const turned = rotateVector(
    { x: world.x - frame.centre.x, y: world.y - frame.centre.y },
    -frame.angle,
  );
  return { x: frame.centre.x + turned.x, y: frame.centre.y + turned.y };
}

/** The four corner handles, on the frame's own axes. */
export function frameCorners(
  frame: RotationFrame,
  gap = 0,
): Array<{ corner: ResizeCorner; x: number; y: number }> {
  return cornerPoints(frame.box, gap).map((entry) => ({
    corner: entry.corner,
    ...framePoint(frame, { x: entry.x, y: entry.y }),
  }));
}

/** Corner under a world point, in the frame's axes. */
export function frameCornerAt(
  frame: RotationFrame,
  world: Vec2,
  tolerance: number,
  gap = 0,
): ResizeCorner | null {
  const local = frameLocal(frame, world);
  let best: ResizeCorner | null = null;
  let bestDistance = Infinity;
  for (const entry of cornerPoints(frame.box, gap)) {
    const distance = Math.hypot(entry.x - local.x, entry.y - local.y);
    if (distance <= tolerance && distance < bestDistance) {
      best = entry.corner;
      bestDistance = distance;
    }
  }
  return best;
}

export interface RotationHandle {
  /** The circle's centre. */
  point: Vec2;
  /** Where the stem leaves the top edge. */
  stemFrom: Vec2;
  /** Where the stem meets the circle. */
  stemTo: Vec2;
}

/**
 * The round handle above the middle of the top side: a 14 px stem and a 10 px circle,
 * both in screen pixels so they stay grabbable at every zoom.
 */
export function rotationHandle(frame: RotationFrame, zoom: number): RotationHandle {
  const midX = frame.box.x + frame.box.width / 2;
  const stem = ROTATE_STEM / zoom;
  const radius = ROTATE_RADIUS / zoom;
  const top = frame.box.y;
  return {
    point: framePoint(frame, { x: midX, y: top - stem - radius }),
    stemFrom: framePoint(frame, { x: midX, y: top }),
    stemTo: framePoint(frame, { x: midX, y: top - stem }),
  };
}

/** Whether a world point is on the rotation circle, within `tolerance` screen pixels. */
export function rotationHandleAt(
  frame: RotationFrame,
  world: Vec2,
  zoom: number,
  tolerance = 12,
): boolean {
  const { point } = rotationHandle(frame, zoom);
  return Math.hypot(point.x - world.x, point.y - world.y) * zoom <= tolerance;
}

/**
 * A turned object's box after dragging one of its corners.
 *
 * The gesture point is un-turned into the object's axes, the ordinary `resizedBox`
 * keeps the opposite local corner fixed, and the resulting centre is turned back into
 * the world. That is what "the opposite corner stays put, in the object's axes" means
 * (T18 acceptance 3). Shift is the same proportion rule as before.
 */
export function resizedTurnedBox(
  widget: Widget,
  corner: ResizeCorner,
  point: Vec2,
  minWidth: number,
  minHeight: number,
  options: ResizeOptions = {},
): Rect {
  const angle = rotationOf(widget);
  if (angle === 0) {
    const box = resizedBox(boxOf(widget), corner, point, minWidth, minHeight, options);
    return {
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
      width: box.width,
      height: box.height,
    };
  }
  const local = localAxesPoint(widget, point);
  const next = resizedBox(
    localRectOf(widget),
    corner,
    local,
    minWidth,
    minHeight,
    options,
  );
  const localCentre = { x: next.x + next.width / 2, y: next.y + next.height / 2 };
  const turned = rotateVector(localCentre, angle);
  return {
    x: widget.x + turned.x,
    y: widget.y + turned.y,
    width: next.width,
    height: next.height,
  };
}

/**
 * Everything a turn carries: the selected objects plus a selected frame's contents.
 *
 * A frame is a container, so the preview has to move its family with it; the command
 * expands the same way, and the two therefore show and write one picture (ADR-110).
 */
export function rotationMembers(
  selected: readonly Widget[],
  widgets: readonly Widget[],
): Widget[] {
  const family = new Set(selected.map((widget) => widget.id));
  const children = new Map<string, Widget[]>();
  for (const widget of widgets) {
    if (!widget.parentId) continue;
    const list = children.get(widget.parentId) ?? [];
    list.push(widget);
    children.set(widget.parentId, list);
  }
  let grew = true;
  while (grew) {
    grew = false;
    for (const widget of [...family]) {
      for (const child of children.get(widget) ?? []) {
        if (family.has(child.id)) continue;
        family.add(child.id);
        grew = true;
      }
    }
  }
  return widgets.filter(
    (widget) => family.has(widget.id) && isRotatable(widget) && !widget.locked,
  );
}

/** The angle of a world point seen from the pivot, in degrees. */
export function angleAt(centre: Vec2, point: Vec2): number {
  return (Math.atan2(point.y - centre.y, point.x - centre.x) * 180) / Math.PI;
}
