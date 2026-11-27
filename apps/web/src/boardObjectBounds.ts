import { connectorPath, pathPolyline, unionBox, type StubOptions } from "@remo/canvas";
import { rotatedBounds, type Rect, type Widget } from "@remo/model";

/** Measure the painted widgets. The canvas resolver places kanban cards in their cells. */
export function boardObjectBounds(
  ids: readonly string[],
  resolve: (id: string) => Widget | undefined,
  stubs: StubOptions,
): Rect | null {
  const boxes: Rect[] = [];
  for (const id of ids) {
    const widget = resolve(id);
    if (!widget) continue;
    if (widget.type !== "connector") {
      boxes.push(rotatedBounds(widget));
      continue;
    }
    const path = connectorPath(widget, resolve, stubs);
    if (path) {
      for (const point of pathPolyline(path)) {
        boxes.push({ ...point, width: 0, height: 0 });
      }
    }
  }
  return unionBox(boxes);
}
