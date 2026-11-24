/**
 * Rotation geometry, in one place (ADR-271, T18, ADR-283).
 *
 * An object turns about its centre. Every question about a turned object — where it is
 * painted, whether a click is on it, which box it occupies for alignment, where a line
 * meets it — is answered by reading the same angle and applying the same inverse
 * transform. Painting is the only caller that does not come through here: it asks the
 * canvas for the angle and rotates its own context once.
 *
 * Degrees are the stored unit. Radians exist only inside a painter, at the last step.
 */
import type { Rect, Vec2, Widget, WidgetType } from "./types";

/** The kinds whose angle is honoured (ADR-271). A table section is a frame, but straight. */
export const ROTATABLE_TYPES: ReadonlySet<WidgetType> = new Set<WidgetType>([
  "shape",
  "sticky_note",
  "text",
  "image",
  "frame",
]);

/** The smallest part of a widget rotation geometry needs. */
type Turnable = Pick<Widget, "type" | "x" | "y" | "width" | "height"> & {
  layout?: Widget["layout"];
  rotation?: number;
};

/**
 * Whether this object's angle means anything.
 *
 * Kanban, tables, connectors, cards and timers keep `rotation` out of the model: a
 * value written there by an older or hostile client is ignored on read, never painted
 * and never used by a hit test.
 */
export function isRotatable(widget: Pick<Widget, "type" | "layout">): boolean {
  if (!ROTATABLE_TYPES.has(widget.type)) return false;
  // A table is a frame with a layout; its grid is axis-aligned, so it never turns.
  if (widget.type === "frame" && widget.layout?.kind === "table") return false;
  return true;
}

/**
 * The stored angle, normalised into (−180, 180].
 *
 * -180 and 180 are the same direction; the product keeps the positive one so a
 * document never holds two spellings of one orientation. A non-number is 0, and a
 * kind that does not turn is 0 whatever the field says.
 */
export function normalizeDegrees(angle: number): number {
  if (!Number.isFinite(angle)) return 0;
  let value = angle % 360;
  if (value > 180) value -= 360;
  else if (value <= -180) value += 360;
  return Object.is(value, -0) ? 0 : value;
}

/** The angle the painter and every hit test should use; 0 for a kind that stays straight. */
export function rotationOf(widget: Pick<Widget, "type" | "layout" | "rotation">): number {
  if (!isRotatable(widget)) return 0;
  return normalizeDegrees(widget.rotation ?? 0);
}

/** True when this object is actually turned. */
export function isTurned(widget: Pick<Widget, "type" | "layout" | "rotation">): boolean {
  return rotationOf(widget) !== 0;
}

const RADIANS = Math.PI / 180;

/** Rotate a vector about the origin, clockwise in screen coordinates (y grows down). */
export function rotateVector(point: Vec2, degrees: number): Vec2 {
  if (degrees === 0) return { x: point.x, y: point.y };
  const cos = Math.cos(degrees * RADIANS);
  const sin = Math.sin(degrees * RADIANS);
  return {
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos,
  };
}

/** Rotate a world point about a world centre. */
export function rotateAround(point: Vec2, centre: Vec2, degrees: number): Vec2 {
  if (degrees === 0) return { x: point.x, y: point.y };
  const dx = point.x - centre.x;
  const dy = point.y - centre.y;
  const cos = Math.cos(degrees * RADIANS);
  const sin = Math.sin(degrees * RADIANS);
  return {
    x: centre.x + dx * cos - dy * sin,
    y: centre.y + dx * sin + dy * cos,
  };
}

/** The object's own rectangle, centred on the origin, without its angle. */
export function localRectOf(widget: Pick<Widget, "width" | "height">): Rect {
  return {
    x: -widget.width / 2,
    y: -widget.height / 2,
    width: widget.width,
    height: widget.height,
  };
}

/** A world point in the object's own axes: the inverse turn about its centre. */
export function localPointOf(
  widget: Pick<Widget, "type" | "layout" | "rotation" | "x" | "y">,
  point: Vec2,
): Vec2 {
  const angle = rotationOf(widget);
  return angle === 0
    ? { x: point.x, y: point.y }
    : rotateAround(point, { x: widget.x, y: widget.y }, -angle);
}

/** A point in the object's own axes back into the world. */
export function worldPointOf(
  widget: Pick<Widget, "type" | "layout" | "rotation" | "x" | "y">,
  local: Vec2,
): Vec2 {
  const angle = rotationOf(widget);
  return angle === 0
    ? { x: local.x, y: local.y }
    : rotateAround(local, { x: widget.x, y: widget.y }, angle);
}

/**
 * A world point in the object's own axes with the origin at its centre.
 *
 * This is the frame a resize works in: the stored box seen from the object, so the
 * opposite corner of a turned object stays where the person sees it (T18 acceptance 3).
 */
export function localAxesPoint(
  widget: Pick<Widget, "type" | "layout" | "rotation" | "x" | "y">,
  point: Vec2,
): Vec2 {
  const angle = rotationOf(widget);
  const dx = point.x - widget.x;
  const dy = point.y - widget.y;
  return angle === 0 ? { x: dx, y: dy } : rotateVector({ x: dx, y: dy }, -angle);
}

/** A point of the object's own axes (origin at its centre) back into the world. */
export function worldAxesPoint(
  widget: Pick<Widget, "type" | "layout" | "rotation" | "x" | "y">,
  local: Vec2,
): Vec2 {
  const angle = rotationOf(widget);
  const turned = angle === 0 ? local : rotateVector(local, angle);
  return { x: widget.x + turned.x, y: widget.y + turned.y };
}

/** The four corners of the object as painted: top-left, top-right, bottom-right, bottom-left. */
export function rotatedCorners(
  widget: Turnable,
): [Vec2, Vec2, Vec2, Vec2] {
  const angle = rotationOf(widget);
  const halfWidth = widget.width / 2;
  const halfHeight = widget.height / 2;
  const centre = { x: widget.x, y: widget.y };
  const corners: Array<Vec2> = [
    { x: widget.x - halfWidth, y: widget.y - halfHeight },
    { x: widget.x + halfWidth, y: widget.y - halfHeight },
    { x: widget.x + halfWidth, y: widget.y + halfHeight },
    { x: widget.x - halfWidth, y: widget.y + halfHeight },
  ];
  const turned = corners.map((point) => rotateAround(point, centre, angle));
  return [turned[0]!, turned[1]!, turned[2]!, turned[3]!];
}

/**
 * The axis-aligned rectangle that contains the painted object.
 *
 * This is what alignment, camera fit, culling and clamping read: a turned note is
 * wider and taller on the board than its stored box, and a guide that ignores that
 * would look a corner off.
 */
export function rotatedBounds(widget: Turnable): Rect {
  if (rotationOf(widget) === 0) {
    return {
      x: widget.x - widget.width / 2,
      y: widget.y - widget.height / 2,
      width: widget.width,
      height: widget.height,
    };
  }
  const corners = rotatedCorners(widget);
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return {
    x: left,
    y: top,
    width: Math.max(...xs) - left,
    height: Math.max(...ys) - top,
  };
}

/** True when a world point lies on the painted rectangle (edges included). */
export function rotatedContains(widget: Turnable, point: Vec2): boolean {
  const local = localPointOf(widget, point);
  const halfWidth = widget.width / 2;
  const halfHeight = widget.height / 2;
  // A click on the contour belongs to the object. The inverse turn and a pointer that
  // is quantised to a fraction of a pixel both leave a point a hair outside; the
  // tolerance is far below one device pixel at the closest zoom.
  const epsilon = 0.01;
  return (
    local.x >= widget.x - halfWidth - epsilon &&
    local.x <= widget.x + halfWidth + epsilon &&
    local.y >= widget.y - halfHeight - epsilon &&
    local.y <= widget.y + halfHeight + epsilon
  );
}

function projected(points: readonly Vec2[], axis: Vec2): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const point of points) {
    const value = point.x * axis.x + point.y * axis.y;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return { min, max };
}

function separated(
  a: readonly Vec2[],
  b: readonly Vec2[],
  axis: Vec2,
): boolean {
  const left = projected(a, axis);
  const right = projected(b, axis);
  return left.max <= right.min || right.max <= left.min;
}

/** Convex polygons overlap when no axis of either edge separates them (SAT). */
function polygonsOverlap(a: readonly Vec2[], b: readonly Vec2[]): boolean {
  for (const polygon of [a, b]) {
    for (let index = 0; index < polygon.length; index += 1) {
      const from = polygon[index]!;
      const to = polygon[(index + 1) % polygon.length]!;
      const axis = { x: -(to.y - from.y), y: to.x - from.x };
      if (axis.x === 0 && axis.y === 0) continue;
      if (separated(a, b, axis)) return false;
    }
  }
  return true;
}

/**
 * Whether a marquee touches the painted object.
 *
 * The marquee used to test the stored box; for a turned object that box is a promise
 * the picture does not keep — its corner covers empty board. The test is the rotated
 * quadrilateral against the marquee rectangle, so touching only the empty corner of
 * the described rectangle does not take the object.
 */
export function rotatedOverlapsRect(widget: Turnable, rect: Rect): boolean {
  if (rotationOf(widget) === 0) {
    const left = widget.x - widget.width / 2;
    const top = widget.y - widget.height / 2;
    return (
      left < rect.x + rect.width &&
      left + widget.width > rect.x &&
      top < rect.y + rect.height &&
      top + widget.height > rect.y
    );
  }
  const corners = rotatedCorners(widget);
  const box = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ];
  return polygonsOverlap(corners, box);
}

/** Nearest right angle when the angle is within `tolerance`, otherwise the angle itself. */
export function rightAngleSnap(angle: number, tolerance = 3): number {
  const value = normalizeDegrees(angle);
  const quarter = Math.round(value / 90) * 90;
  const nearest = normalizeDegrees(quarter);
  return Math.abs(normalizeDegrees(value - nearest)) <= tolerance ? nearest : value;
}

/** Snap to a step, used by Shift: the value lands on the nearest multiple of `step`. */
export function snapToStep(angle: number, step: number): number {
  if (!Number.isFinite(step) || step <= 0) return normalizeDegrees(angle);
  return normalizeDegrees(Math.round(angle / step) * step);
}

/** The centre of a set of objects' painted boxes; null for an empty set. */
export function selectionCentre(
  widgets: readonly Turnable[],
): Vec2 | null {
  if (!widgets.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const widget of widgets) {
    const box = rotatedBounds(widget);
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.height);
  }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

/** One object after a turn about a shared centre. */
export interface TurnedPlacement {
  id: string;
  x: number;
  y: number;
  rotation: number;
  /** The angle changed, not only the position (used to skip a no-op write). */
  turned: boolean;
}

/**
 * Every object of a selection after turning it by `delta` about `centre`.
 *
 * The centre itself does not move, so a single object stays where it is and only its
 * angle changes; several objects each keep their distance from the common centre and
 * gain their own angle — one gesture, one answer for the whole set (T18 acceptance 6).
 */
export interface TurnOptions {
  /** Shift: the gesture turns in whole steps, 15° in the product. */
  step?: number;
  /** The magnet: a final angle within three degrees of a right angle lands on it. */
  magnet?: boolean;
}

/**
 * The delta a gesture actually applies.
 *
 * One reading of the modifiers for the preview and for the command, so the picture the
 * person sees before the release is exactly what the release writes.
 */
export function turnDelta(delta: number, options: TurnOptions = {}): number {
  const value = normalizeDegrees(delta);
  return options.step ? snapToStep(value, options.step) : value;
}

export function turnedPlacements(
  widgets: readonly (Turnable & { id: string })[],
  centre: Vec2,
  delta: number,
  options: TurnOptions = {},
): TurnedPlacement[] {
  const step = turnDelta(delta, options);
  return widgets
    .filter((widget) => isRotatable(widget))
    .map((widget) => {
      const id = widget.id;
      const from = rotationOf(widget);
      const raw = normalizeDegrees(from + step);
      const to = options.magnet ? rightAngleSnap(raw, 3) : raw;
      if (step === 0) {
        return { id, x: widget.x, y: widget.y, rotation: from, turned: false };
      }
      const point = rotateAround({ x: widget.x, y: widget.y }, centre, step);
      return {
        id,
        x: point.x,
        y: point.y,
        rotation: to,
        turned: to !== from || point.x !== widget.x || point.y !== widget.y,
      };
    });
}
