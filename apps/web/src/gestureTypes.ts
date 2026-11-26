import type { AlignmentGuide, Camera, KanbanLayout } from "@remo/canvas";
import type { ConnectorPatch, NoteDirection, WidgetPosition, WidgetRect } from "@remo/doc";
import type { ConnectorSide, Rect, ShapeKind, Vec2, TurnOptions, Widget } from "@remo/model";
import type { BoardSettings } from "./settings";

/**
 * The pointer state machine: what a press, a drag and a release mean (ADR-059).
 *
 * It owns the gesture state and hands the component back what it needs to paint: the
 * preview patches, the guides, the marquee, the connector draft and the hover.
 */

export interface GestureDeps {
  camera: Camera;
  viewport: { width: number; height: number };
  settings: BoardSettings;
  widgets: Widget[];
  layouts: Map<string, KanbanLayout>;
  selectedIds: readonly string[];
  isCardOfKanban: (widget: Widget) => boolean;
  toWorld: (event: { clientX: number; clientY: number }) => { x: number; y: number };
  /** The board canvas, for measuring a connector label with the painter's font. */
  boardRef: React.RefObject<HTMLCanvasElement | null>;
  /** World point to client coordinates, for the 14-pixel anchor and handle targets. */
  worldToScreenPoint: (point: { x: number; y: number }) => { x: number; y: number };
  onCamera: (camera: Camera) => void;
  onSelect: (ids: string[]) => void;
  onMoveMany: (positions: WidgetPosition[]) => void;
  /** Commit a resize gesture: one object or a block, one transaction, one undo. */
  onResizeMany: (rects: WidgetRect[], scale?: { from: Rect; kx: number; ky: number }) => void;
  /**
   * Commit a turn: one transaction for the whole gesture (ADR-271, T18). The geometry
   * is the model's `turnedPlacements`, so the preview and the write agree.
   */
  onRotateMany: (ids: readonly string[], delta: number, options?: TurnOptions) => void;
  /** Move a kanban column or lane to an index among the others (ADR-244). */
  onMoveKanbanAxis: (kanbanId: string, kind: "column" | "lane", id: string, index: number) => void;
  onColumnTitleClick: (target: Extract<import("./canvasTargets").ContextTarget, {kind: "column"}>, world: Vec2, screen: Vec2) => void;
  /** Drop a card in a cell, before `beforeCardId` or at the end (null). */
  onMoveCard: (
    kanbanId: string,
    cardId: string,
    columnId: string,
    swimlaneId: string,
    beforeCardId: string | null,
  ) => void;
  /** Drop a selection into a table cell as one transaction (ADR-196). */
  onMoveToCell: (
    frameId: string,
    rowId: string,
    columnId: string,
    ids: string[],
    offset: { x: number; y: number },
  ) => void;
  onCreateFirstSticker: (at: Vec2) => void;
  onAddCard: (kanbanId: string, columnId: string, swimlaneId: string) => void;
  onConnect: (
    fromId: string,
    toId: string,
    sides: { startSide: ConnectorSide; endSide: ConnectorSide },
  ) => string | null;
  onConnectorPatch: (id: string, patch: ConnectorPatch) => void;
  onAddWaypoint: (id: string, x: number, y: number, index?: number) => boolean;
  onMoveWaypoint: (id: string, waypointId: string, x: number, y: number) => void;
  onDeleteWaypoint: (id: string, waypointId: string) => void;
  /** The 32-point limit was hit; the app shows the message. */
  onLimit: () => void;
  onReattachEnd: (
    id: string,
    end: "start" | "end",
    item: string,
    side?: ConnectorSide,
  ) => void;
  onEdit: (id: string | null) => void;
  /**
   * Toggle a checkbox line in block text without opening the editor (ADR-252 §8).
   *
   * One command behind it: the permission check, the undo step and the audit row are the
   * document's, not the gesture's.
   */
  onToggleCheck: (id: string, line: number) => void;
  /** Click an anchor without dragging: grow a connected clone in that direction. */
  onCreateConnected: (id: string, direction: NoteDirection) => void;
  onCursor: (cursor: { x: number; y: number } | null) => void;
  /**
   * The armed shape tool (ADR-271): a drag on the canvas draws it at size, a click
   * without a drag creates the default shape at the centre.
   */
  creationTool?: CreationTool | null;
  /**
   * The viewer may read but not write (viewer role or a public link).
   *
   * Selection, pan and the marquee still work — reading a board means being able to
   * look at things — but nothing that changes the document starts (ADR-062).
   */
  readOnly?: boolean;
}

export interface ConnectDraft {
  fromId: string;
  fromSide: ConnectorSide;
  x: number;
  y: number;
  targetId?: string;
  targetSide?: ConnectorSide;
  targetPoint?: { x: number; y: number };
}

/** The armed shape tool and the one call that turns a gesture into a document command. */
export type CreationTool = (
  | { tool: "shape"; kind: ShapeKind; onDraw: (kind: ShapeKind, box: Rect | null, at: Vec2) => void }
  | { tool: "sticky" | "text"; onPlace: (at: Vec2) => void }
) & { series: boolean; cancel: () => void };

export interface Gestures {
  cursor: { x: number; y: number } | null;
  dragPreview: { cardId: string; x: number; y: number } | null;
  draggedCardId: string | null;
  hoverCell: { columnId: string; swimlaneId: string } | null;
  /** The table cell the dragged selection would land in. */
  tableHover: { frameId: string; rowId: string; columnId: string } | null;
  /** The pointer is over a header, which never takes objects. */
  tableRefused: boolean;
  marquee: Rect | null;
  /** The shape being drawn, in board units: the overlay draws its dashed outline and size. */
  shapeDraft: { rect: Rect; kind: ShapeKind } | null;
  /** The angle plate during a turn: the angle and the world point it points at. */
  rotationDraft: { angle: number; x: number; y: number } | null;
  /** The pointer is over the round handle: the overlay asks for the rotation cursor. */
  rotationHover: boolean;
  preview: ReadonlyMap<string, Partial<Widget>>;
  dragIds: string[];
  dragGhostIds: string[];
  guides: AlignmentGuide[];
  /** The floored size while a resize is stopped at a minimum, or null. */
  resizeLimit: { width: number; height: number } | null;
  setResizeLimit: (limit: { width: number; height: number } | null) => void;
  hoverId: string | null;
  connectDraft: ConnectDraft | null;
  hoverAnchor: { id: string; side: ConnectorSide } | null;
  /** A widget as it looks right now: the stored one, a card's cell, plus the preview. */
  resolve: (id: string) => Widget | undefined;
  /** Drop the hover ring and the highlighted anchor (the pointer left the canvas). */
  clearHover: () => void;
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerMove: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerUp: () => void;
  onPointerCancel: (event: React.PointerEvent<HTMLElement>) => void;
  onDoubleClick: (event: React.MouseEvent<HTMLElement>) => void;
  /**
   * Begin a line from a side of an object, as a press on its port would (ADR-201: the
   * edge "+" and the port are one handle). The caller forwards the rest of the drag.
   */
  startConnect: (
    fromId: string,
    side: import("@remo/model").ConnectorSide,
    client: { x: number; y: number },
  ) => void;
}
