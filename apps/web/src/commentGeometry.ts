import { pick, type Camera, type KanbanLayout } from "@remo/canvas";
import { localAxesPoint, worldAxesPoint, type Vec2, type Widget } from "@remo/model";
import { placementOfCard } from "./canvasGeometry";
import type { CommentAnchor } from "./commentsApi";

type Layouts = Map<string, KanbanLayout>;

function bounds(widget: Widget, layouts: Layouts) {
  const cell = widget.type === "card" && placementOfCard(layouts, widget.id);
  return cell ? { ...widget, x: cell.x, y: cell.y, width: cell.width, height: cell.height } : widget;
}

export function pinWorld(anchor: CommentAnchor, widget: Widget | undefined, layouts: Layouts): Vec2 | null {
  if (anchor.kind === "point") return { x: anchor.x, y: anchor.y };
  if (!widget) return null;
  const box = bounds(widget, layouts);
  return worldAxesPoint(box, { x: ((anchor.fx ?? .5) - .5) * box.width, y: ((anchor.fy ?? 0) - .5) * box.height });
}

export function anchorAt(world: Vec2, widgets: Widget[], layouts: Layouts): CommentAnchor {
  let card: Widget | undefined;
  for (const layout of layouts.values()) {
    const cell = layout.placements.find(box =>
      Math.abs(world.x - box.x) <= box.width / 2 && Math.abs(world.y - box.y) <= box.height / 2);
    if (cell) { card = widgets.find(widget => widget.id === cell.cardId); break; }
  }
  const hit = card ?? pick(widgets, world, w => w.type === "card" && !!w.parentId && layouts.has(w.parentId));
  if (!hit || hit.type === "connector") return { kind: "point", ...world };
  const box = bounds(hit, layouts);
  const local = localAxesPoint(box, world);
  const fraction = (n: number, size: number) => size ? Math.min(1, Math.max(0, n / size + .5)) : .5;
  return { kind: "widget", widgetId: hit.id, fx: fraction(local.x, box.width), fy: fraction(local.y, box.height) };
}

export function fromClient(clientX: number, clientY: number, camera: Camera): Vec2 | null {
  const rect = document.querySelector(".layer.overlay")?.getBoundingClientRect();
  return rect ? { x: camera.x + (clientX - rect.left - rect.width / 2) / camera.zoom,
    y: camera.y + (clientY - rect.top - rect.height / 2) / camera.zoom } : null;
}
