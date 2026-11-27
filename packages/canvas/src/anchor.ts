/**
 * Where a line meets an object.
 *
 * A box anchor is a point on a side; a silhouette anchor is the same point folded onto
 * the shape that is actually drawn, so a connector to a triangle does not stop in the
 * empty corner of its bounding box (ADR-271). Painters, ports and connectors call these
 * functions and nothing else, so a line and the dot it was pulled from agree.
 */
import {
  localPointOf,
  rotateVector,
  rotationOf,
  type ConnectorSide,
  type Rect,
  type ShapeKind,
  type Vec2,
  type Widget,
} from "@remo/model";

export function boxOf(widget: Widget): Rect {
  return {
    x: widget.x - widget.width / 2,
    y: widget.y - widget.height / 2,
    width: widget.width,
    height: widget.height,
  };
}

/** The object's own rectangle in its own axes, centred on the origin. */
export function localBoxOf(widget: Widget): Rect {
  return {
    x: -widget.width / 2,
    y: -widget.height / 2,
    width: widget.width,
    height: widget.height,
  };
}

/** Unit vector pointing out of the given side. */
export function sideNormal(side: ConnectorSide): Vec2 {
  switch (side) {
    case "left":
      return { x: -1, y: 0 };
    case "right":
      return { x: 1, y: 0 };
    case "top":
      return { x: 0, y: -1 };
    case "bottom":
      return { x: 0, y: 1 };
  }
}

/** Side of `box` that faces `towards`. */
export function facingSide(box: Rect, towards: Vec2): ConnectorSide {
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  const dx = towards.x - centerX;
  const dy = towards.y - centerY;

  // Compare against the box's aspect so a wide note does not answer "left" for a
  // point that is almost directly below it.
  const scaleX = dx / Math.max(box.width / 2, 1);
  const scaleY = dy / Math.max(box.height / 2, 1);
  if (Math.abs(scaleX) >= Math.abs(scaleY)) return scaleX >= 0 ? "right" : "left";
  return scaleY >= 0 ? "bottom" : "top";
}

/** Point on `side` of `box`, `offset` along it (0.5 is the middle). */
export function anchorPoint(box: Rect, side: ConnectorSide, offset = 0.5): Vec2 {
  const t = Math.min(1, Math.max(0, offset));
  switch (side) {
    case "left":
      return { x: box.x, y: box.y + t * box.height };
    case "right":
      return { x: box.x + box.width, y: box.y + t * box.height };
    case "top":
      return { x: box.x + t * box.width, y: box.y };
    case "bottom":
      return { x: box.x + t * box.width, y: box.y + box.height };
  }
}

/**
 * Anchor of an object, on the outline that is actually painted.
 *
 * A rectangle, a rounded rectangle, an ellipse and a diamond already meet their box at
 * the side midpoint, so only the triangle needs another answer: its left and right sides
 * are slanted, and the point halfway down the box is outside the shape. The apex and the
 * base are on the box, so the top and bottom anchors stay where they were.
 */
export function outlineAnchor(
  box: Rect,
  side: ConnectorSide,
  kind?: ShapeKind,
): Vec2 {
  if (kind !== "triangle") return anchorPoint(box, side);
  if (side === "top") return { x: box.x + box.width / 2, y: box.y };
  if (side === "bottom") return { x: box.x + box.width / 2, y: box.y + box.height };
  return {
    x: box.x + box.width * (side === "left" ? 0.25 : 0.75),
    y: box.y + box.height / 2,
  };
}

/**
 * Point where the line from `from` to `to` leaves `box`.
 *
 * Used when an end has no explicit side: clipping to the box (rather than starting
 * at the centre) keeps arrow heads and line caps off the object they belong to.
 */
/**
 * Anchor of an object on its painted outline, its own angle included (ADR-271, T18).
 *
 * The local anchor is the point the side gives in the object's own axes; the turn puts
 * it where the painter draws the edge. A straight object is the old answer exactly.
 */
export function widgetAnchor(widget: Widget, side: ConnectorSide): Vec2 {
  const angle = rotationOf(widget);
  if (angle === 0) return outlineAnchor(boxOf(widget), side, widget.shapeKind);
  const local = outlineAnchor(localBoxOf(widget), side, widget.shapeKind);
  const turned = rotateVector(local, angle);
  return { x: widget.x + turned.x, y: widget.y + turned.y };
}

/** Outward normal of a side in the object's own axes, turned into the world. */
export function widgetSideNormal(widget: Widget, side: ConnectorSide): Vec2 {
  return rotateVector(sideNormal(side), rotationOf(widget));
}

/**
 * The side of a turned object that faces a world point.
 *
 * Read in the object's axes, so "the side facing the other end" means the side the
 * person sees, not the side of the object's unrotated memory.
 */
export function facingSideOf(widget: Widget, towards: Vec2): ConnectorSide {
  const angle = rotationOf(widget);
  if (angle === 0) return facingSide(boxOf(widget), towards);
  return facingSide(localBoxOf(widget), localPointOf(widget, towards));
}

export function edgePoint(box: Rect, towards: Vec2): Vec2 {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const dx = towards.x - cx;
  const dy = towards.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };

  const halfWidth = box.width / 2;
  const halfHeight = box.height / 2;
  const scale = Math.min(
    dx === 0 ? Infinity : Math.abs(halfWidth / dx),
    dy === 0 ? Infinity : Math.abs(halfHeight / dy),
  );
  return { x: cx + dx * scale, y: cy + dy * scale };
}
