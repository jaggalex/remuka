import { useCallback, useEffect, useImperativeHandle, useRef, type Ref, type RefObject } from "react";
import { fitToBounds, unionBox, visibleWorldRect, zoomAt, type Camera } from "@remo/canvas";
import { rotatedBounds, type Rect, type Widget } from "@remo/model";
import { fitTidyPreview } from "./proposalStore";
import { boardObjectBounds } from "./boardObjectBounds";
import type { BoardSettings } from "./settings";

export type FitObjects = (ids: readonly string[]) => boolean;

/** The camera is centred on the full canvas; move the fitted content into its exposed area. */
function fitUnobstructed(bounds: Rect, viewport: Rect, left: number, bottom: number): Camera {
  const centered = fitToBounds(bounds, viewport);
  const width = viewport.width - left;
  const height = viewport.height - bottom;
  if (width <= 0 || height <= 0) return centered;
  const horizontalMargin = (viewport.width - bounds.width * centered.zoom) / 2;
  const verticalMargin = (viewport.height - bounds.height * centered.zoom) / 2;
  if (horizontalMargin >= left && verticalMargin >= bottom) return centered;
  const fit = fitToBounds(bounds, { x: 0, y: 0, width, height });
  return { x: fit.x - left / (2 * fit.zoom), y: fit.y + bottom / (2 * fit.zoom), zoom: fit.zoom };
}

/**
 * The camera fit and the two HUD zoom buttons.
 *
 * `BoardCanvas` was at the 800-line limit when the edge "+" arrived (ADR-093). This is
 * one reason to change on its own: the viewport arithmetic and the once-per-load fit
 * do not need the gesture machine or the chrome around them.
 */
export function useBoardCameraFit({
  camera,
  setCamera,
  viewport,
  canvasRef,
  widgets,
  selectedIds,
  widgetById,
  fitKey,
  synced,
  fitObjectsRef,
  connectors,
}: {
  camera: Camera;
  setCamera: (camera: Camera) => void;
  viewport: { width: number; height: number };
  canvasRef: RefObject<HTMLDivElement | null>;
  widgets: Widget[];
  selectedIds: readonly string[];
  widgetById: (id: string) => Widget | undefined;
  fitKey: string;
  synced: boolean;
  fitObjectsRef: Ref<FitObjects>;
  connectors: BoardSettings["connectors"];
}) {
  const frameBounds = useCallback((target: Rect | null, avoidControls = true) => {
    if (!target || !viewport.width || !viewport.height) return false;
    const surface = { x: 0, y: 0, ...viewport };
    const canvas = canvasRef.current;
    if (avoidControls && canvas) {
      const box = canvas.getBoundingClientRect();
      const rail = canvas.parentElement?.querySelector(".tool-rail-panel")?.getBoundingClientRect();
      const hud = canvas.querySelector(".canvas-hud")?.getBoundingClientRect();
      const left = rail?.width ? Math.max(0, rail.right - box.left) : 0;
      const bottom = hud?.height ? Math.max(0, box.bottom - hud.top) : 0;
      setCamera(fitUnobstructed(target, surface, left, bottom));
    } else {
      setCamera(fitToBounds(target, surface));
    }
    return true;
  }, [canvasRef, setCamera, viewport]);
  useImperativeHandle(fitObjectsRef, () => ids => frameBounds(boardObjectBounds(ids, widgetById, {
    max: connectors.stubMax, ratio: connectors.stubRatio,
  })), [connectors.stubMax, connectors.stubRatio, frameBounds, widgetById]);

  const fitContents = useCallback((avoidControls: boolean) => {
    const ids = selectedIds.length ? selectedIds : widgets.map(widget => widget.id);
    const boxes = ids.map(widgetById).filter((widget): widget is Widget => Boolean(widget)).map(rotatedBounds);
    frameBounds(unionBox(boxes), avoidControls);
  }, [frameBounds, selectedIds, widgetById, widgets]);

  /** Zoom around the middle of the canvas, for the two HUD buttons. */
  const zoomBy = useCallback(
    (factor: number) => {
      setCamera(
        zoomAt(
          camera,
          { x: 0, y: 0, width: viewport.width, height: viewport.height },
          { x: viewport.width / 2, y: viewport.height / 2 },
          factor,
        ),
      );
    },
    [camera, setCamera, viewport.height, viewport.width],
  );

  const inView = (content: Widget[]) => {
    const box = unionBox(content.map((widget) => rotatedBounds(widget)));
    if (!box) return false;
    const view = visibleWorldRect(camera, viewport);
    return (
      box.x >= view.x &&
      box.y >= view.y &&
      box.x + box.width <= view.x + view.width &&
      box.y + box.height <= view.y + view.height
    );
  };

  const fittedFor = useRef<string | null>(null);
  const emptyAfterSync = useRef<string | null>(null);

  useEffect(() => {
    if (viewport.width <= 1 || viewport.height <= 1) return;
    if (!widgets.length) {
      if (synced) emptyAfterSync.current = fitKey;
      return;
    }
    // Opening or resizing an inspector changes the canvas, not the user's chosen camera.
    const key = `${fitKey}@${window.innerWidth}x${window.innerHeight}`;
    if (fittedFor.current === key) return;
    fittedFor.current = key;
    // A room that opened empty keeps its view when its first content is already in
    // sight — the first note appears where the person is looking, at the current zoom
    // (ADR-197) — or is a server draft. Content larger than the view is fitted once.
    if (
      emptyAfterSync.current === fitKey &&
      (inView(widgets) || widgets.every((widget) => widget.agent?.skill === "room-draft"))
    ) {
      return;
    }
    fitContents(false);
  }, [fitContents, fitKey, synced, viewport.height, viewport.width, widgets]);

  const fit = () => {
    if (!fitTidyPreview(canvasRef.current)) fitContents(true);
  };
  return { fit, zoomBy };
}
