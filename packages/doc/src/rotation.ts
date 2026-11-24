import {
  isRotatable,
  normalizeDegrees,
  rotateAround,
  rotationOf,
  selectionCentre,
  turnedPlacements,
  type TurnOptions,
  type Widget,
} from "@remo/model";
import type { BoardDocument } from "./board";
import { descendants } from "./tree";

/**
 * Turning objects: one gesture, one transaction (ADR-271, T18, ADR-283).
 *
 * The geometry is the model's, not this module's: `turnedPlacements` answers what the
 * preview shows, and the command writes exactly those numbers. That is what makes the
 * picture during a drag and the document after the release agree, and what lets a
 * multi-selection turn about one shared centre with each object keeping its own angle.
 */

/**
 * Every object the gesture may turn: a kind that turns, unlocked, present.
 *
 * A frame is a container, so turning it carries its contents by the same angle about
 * the same centre. A child that is selected on its own is added once; a locked object
 * keeps its orientation, as it keeps its size and text (ADR-040).
 */
function turnRoots(board: BoardDocument, ids: readonly string[]): Widget[] {
  const out: Widget[] = [];
  for (const id of ids) {
    const widget = board.readWidget(id);
    if (!widget || !isRotatable(widget) || widget.locked) continue;
    out.push(widget);
  }
  return out;
}

function turnable(board: BoardDocument, ids: readonly string[]): Widget[] {
  const out: Widget[] = [];
  const seen = new Set<string>();
  const add = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    const widget = board.readWidget(id);
    if (!widget || !isRotatable(widget) || widget.locked) return;
    out.push(widget);
  };
  for (const id of ids) {
    add(id);
    const root = board.readWidget(id);
    // A locked frame does not move, and neither does its family (ADR-040). A table is
    // a frame that never turns, so its cells are not carried either.
    if (!root || root.locked || !isRotatable(root) || root.type !== "frame") continue;
    for (const childId of descendants(board, id)) add(childId);
  }
  return out;
}

/**
 * Rotate a selection by `delta` degrees about its painted centre.
 *
 * Locked objects are left alone: the lock protects what the object is (ADR-040), and
 * an orientation is part of that. A selection with nothing to turn costs no undo step.
 */
export function rotateWidgets(
  board: BoardDocument,
  ids: readonly string[],
  delta: number,
  options: TurnOptions = {},
): void {
  // The pivot is the selection the person made, not the family a frame carries: a
  // turned frame stays in place and its contents go round it (ADR-110, T18).
  const roots = turnRoots(board, ids);
  if (!roots.length) return;
  const centre = selectionCentre(roots);
  if (!centre) return;
  const members = turnable(board, ids);
  const placements = turnedPlacements(members, centre, delta, options).filter(
    (entry) => entry.turned,
  );
  if (!placements.length) return;
  board.transact(() => {
    for (const placement of placements) {
      const current = board.readWidget(placement.id);
      if (!current || !isRotatable(current) || current.locked) continue;
      board.widgets.set(placement.id, {
        ...current,
        x: placement.x,
        y: placement.y,
        rotation: placement.rotation,
      });
    }
  });
}

/**
 * Set an exact angle without moving anything: "Reset rotation" (T18).
 *
 * The pivot is the centre, which a turn never moves, so resetting an object puts its
 * box back where the stored coordinates say it is — the same place it would occupy if
 * it had never been turned.
 */
export function setWidgetRotation(
  board: BoardDocument,
  ids: readonly string[],
  angle: number,
): void {
  const value = normalizeDegrees(angle);
  const done = new Set<string>();
  board.transact(() => {
    for (const id of ids) {
      if (done.has(id)) continue;
      const widget = board.readWidget(id);
      if (!widget || !isRotatable(widget) || widget.locked) continue;
      const current = normalizeDegrees(widget.rotation ?? 0);
      if (widget.type !== "frame") {
        done.add(id);
        if (current === value) continue;
        board.widgets.set(id, { ...widget, rotation: value });
        continue;
      }
      // A frame resets its contents with it: the children were turned about the frame's
      // centre, so the same centre takes them back (ADR-110, T18).
      const delta = normalizeDegrees(value - current);
      const centre = { x: widget.x, y: widget.y };
      for (const memberId of [id, ...descendants(board, id)].reverse()) {
        if (done.has(memberId)) continue;
        done.add(memberId);
        const live = board.readWidget(memberId);
        if (!live || !isRotatable(live) || live.locked) continue;
        const turned = rotateAround(
          { x: live.x, y: live.y },
          memberId === id ? { x: widget.x, y: widget.y } : centre,
          delta,
        );
        const liveRotation = rotationOf(live);
        const rotation = normalizeDegrees(liveRotation + delta);
        if (turned.x === live.x && turned.y === live.y && rotation === liveRotation) continue;
        board.widgets.set(live.id, { ...live, x: turned.x, y: turned.y, rotation });
      }
    }
  });
}
