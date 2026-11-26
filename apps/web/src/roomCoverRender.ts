import { DEFAULT_THEME, imageFieldsOf } from "@remo/canvas";
import { snapshotFromUpdate, colorForAccount } from "@remo/doc";
import { rotatedBounds } from "@remo/model";
import { layoutsFor, paintExportObjects, scopeBounds, scopeWidgets } from "./exportRender";

/** The sync worker has its own JS realm. It passes bytes across the boundary, never a live Y.Doc. */
export function coverScene(update: Uint8Array) {
  const { widgets, kanbanStates, tags, coverFrameId } = snapshotFromUpdate(update);
  const frame = widgets.find((widget) => widget.type === "frame" && widget.id === coverFrameId);
  const scoped = frame ? scopeWidgets(widgets, [frame.id], "frame") : widgets;
  const layouts = layoutsFor(widgets, kanbanStates);
  const box = frame ? rotatedBounds(frame) : scopeBounds(scoped, layouts);
  const byId = new Map(widgets.map((widget) => [widget.id, widget]));
  const theme = { ...DEFAULT_THEME, assigneeColor: colorForAccount, tags: new Map(Object.entries(tags)) };
  const width = 640;
  const height = 360;
  const scale = box ? Math.max(width / Math.max(1, box.width), height / Math.max(1, box.height)) : 1;
  const left = box ? box.x + (box.width - width / scale) / 2 : 0;
  const top = box ? box.y + (box.height - height / scale) / 2 : 0;
  const fileIds = new Set<string>();
  for (const widget of scoped) {
    if (widget.type !== "image") continue;
    const bounds = rotatedBounds(widget);
    if (bounds.x > left + width / scale || bounds.x + bounds.width < left ||
      bounds.y > top + height / scale || bounds.y + bounds.height < top) continue;
    const id = imageFieldsOf(widget).fileId;
    if (id) fileIds.add(id);
  }
  return {
    width, height, fileIds: [...fileIds],
    paint(ctx: CanvasRenderingContext2D, images: Map<string, ImageBitmap>) {
      ctx.fillStyle = theme.palette.canvas;
      ctx.fillRect(0, 0, width, height);
      if (!box) return;
      ctx.save();
      ctx.translate(width / 2, height / 2);
      ctx.scale(scale, scale);
      ctx.translate(-box.x - box.width / 2, -box.y - box.height / 2);
      paintExportObjects(ctx, {
        widgets, theme, image: (widget) => images.get(imageFieldsOf(widget).fileId ?? "") ?? null,
        imageUnavailable: (widget) => !images.has(imageFieldsOf(widget).fileId ?? ""),
      }, scoped, layouts, byId, scale);
      ctx.restore();
    },
  };
}
