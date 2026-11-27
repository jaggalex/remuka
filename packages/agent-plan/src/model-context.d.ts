interface SharedDocument { getMap(name: string): unknown }
export interface ModelObject { id: string; type: string; text: string }
export interface ModelSelection {
  objects: ModelObject[];
  allowedIds: string[];
  texts: string[];
  connectors: { id: string; from: string; to: string }[];
  counts: { selected: number; expanded: number; included: number; texts: number; chars: number; duplicates: number; empty: number; groups: number; frames: number; connectors: number };
  truncated: boolean;
}
export const SNAPSHOT_LIMITS: Readonly<{ objects: number; frames: number; kanbans: number; columns: number }>;
interface SelectionItem extends ModelObject { x: number; y: number; width: number; height: number; parentId: string | null }
export function readingOrder(a: Pick<SelectionItem, "id" | "x" | "y">, b: Pick<SelectionItem, "id" | "x" | "y">): number;
export function expandSelection(doc: SharedDocument, ids: readonly string[]): {
  objects: SelectionItem[]; connectors: ModelSelection["connectors"]; frames: string[]; groups: string[];
};
export function buildSelectionSource(doc: SharedDocument, ids: readonly string[], limits?: {objects: number; chars: number}): ModelSelection;
export function selectionTexts(doc: SharedDocument, ids: readonly string[]): ModelObject[];
export function boardSnapshot(doc: SharedDocument): {
  objects: {id: string; type: string; x: number; y: number; width: number; height: number}[];
  frames: string[];
  kanbans: { id: string; columns: string[] }[];
  counts: { objects: number; described: number; truncated: boolean };
};
