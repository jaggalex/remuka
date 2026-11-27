import { useEffect, useRef, type CSSProperties } from "react";
import { columnCountText, columnHeaderBox, columnHeaderInk, columnHeaderText, type Camera, type CanvasPalette, type KanbanLayout } from "@remo/canvas";
import { ink, type Widget } from "@remo/model";
import { Button } from "@remo/ui";
import type { Gestures } from "./gestureTypes";
import type { ContextTarget } from "./canvasTargets";
import { useI18n } from "./i18n";

type Point = { x: number; y: number };
type OpenMenu = (target: ContextTarget, point: Point & { world: Point }) => void;

/** Leave the second click and drags to the existing on-canvas title editor and reordering gesture. */
export function useColumnTitleMenu(open: OpenMenu) {
  const pending = useRef<number | undefined>(undefined);
  const cancel = () => { window.clearTimeout(pending.current); };
  useEffect(() => cancel, []);
  return {
    cancel,
    schedule(target: Extract<ContextTarget, {kind: "column"}>, world: Point, screen: Point) {
      cancel();
      pending.current = window.setTimeout(() => open(target, { ...screen, world }), 380);
    },
  };
}

/** One button over the same header painted for the board and PNG export. */
export function KanbanColumnMenus({ layouts, viewport, camera, open, openColumn, resolve, palette,
  gestures, cancel, readOnly, fontFamily }: {
  layouts: Map<string, KanbanLayout>; viewport: {width: number; height: number}; camera: Camera; open: OpenMenu;
  openColumn?: Extract<ContextTarget, {kind: "column"}>;
  resolve: (id: string) => Widget | undefined;
  palette: CanvasPalette; gestures: Gestures; cancel: () => void; readOnly: boolean; fontFamily: string;
}) {
  const { t } = useI18n();
  const press = useRef<Point | null>(null);
  return Array.from(layouts, ([kanbanId, layout]) => layout.columns.map((column, index) => {
    const widget = resolve(kanbanId);
    if (!widget) return null;
    const box = columnHeaderBox(layout, column, camera.zoom);
    const x = (box.x - camera.x) * camera.zoom + viewport.width / 2;
    const y = (box.y - camera.y) * camera.zoom + viewport.height / 2;
    if (box.width * camera.zoom < 32 || x + box.width * camera.zoom < 0 || x > viewport.width ||
        y + box.height * camera.zoom < 0 || y > viewport.height) return null;
    const expanded = openColumn?.kanbanId === kanbanId && openColumn.columnId === column.id;
    const paper = palette.objectPaper;
    const headerInk = columnHeaderInk(column, paper, palette);
    const style = { left: x, top: y, width: box.width, height: box.height, transform: `scale(${camera.zoom})`, fontFamily,
      "--column-fill": column.accent, "--column-marker-ink": ink(paper, "icon"),
      "--column-header-ink": headerInk.color, "--column-header-paper": paper } as CSSProperties;
    const target = { kind: "column" as const, kanbanId, columnId: column.id, index };
    const world = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    return <Button key={kanbanId + ":" + column.id} variant="ghost" className="kanban-column-menu"
      aria-haspopup="menu" aria-expanded={expanded} aria-label={t("menu.column", { title: column.title })}
      aria-description={columnHeaderText(column)} style={style}
      onPointerDown={event => {
        cancel();
        press.current = { x: event.clientX, y: event.clientY };
        gestures.onPointerDown(event);
      }}
      onPointerMove={gestures.onPointerMove} onPointerUp={gestures.onPointerUp}
      onPointerCancel={event => { cancel(); press.current = null; gestures.onPointerCancel(event); }}
      onDoubleClick={event => { cancel(); gestures.onDoubleClick(event); }}
      onContextMenu={event => { event.preventDefault(); cancel(); open(target, {x: event.clientX, y: event.clientY, world}); }}
      onClick={event => {
        // Editable pointer clicks are deferred by the canvas gesture to distinguish
        // rename and drag. Native keyboard activation and read-only taps open directly.
        if (event.detail && (!(readOnly || widget.locked) || !press.current || event.altKey ||
            event.ctrlKey || event.metaKey || Math.hypot(event.clientX - press.current.x, event.clientY - press.current.y) > 4)) return;
        const rect = event.currentTarget.getBoundingClientRect();
        open(target, { x: rect.left, y: rect.bottom, world });
      }}>
      <span className="kanban-column-name">{column.title}</span>
      <span>· {columnCountText(column)}</span>
      <span className="kanban-column-swatch" aria-hidden="true" />
      <span className="kanban-column-marker" aria-hidden="true" />
    </Button>;
  }));
}
