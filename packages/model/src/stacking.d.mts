import type { Widget, WidgetType } from "./types";

interface LayerMap {
  values(): IterableIterator<Widget>;
}
export const PAINT_RANK: Readonly<Record<WidgetType, number>>;
export function rankOf(widget: Pick<Widget, "type">): number;
export function layerKey(widget: Widget): number;
export function topZ(board: { widgets: LayerMap }): number;
export function creationLayers(board: { widgets: LayerMap }, ordered: readonly Widget[]): Map<string, Pick<Widget, "z" | "zTie">>;
export function withLayer(widget: Widget, placement: Pick<Widget, "z" | "zTie">): Widget;
export function insertNewWidget(widgets: LayerMap & { set(id: string, widget: Widget): unknown }, widget: Widget): void;
