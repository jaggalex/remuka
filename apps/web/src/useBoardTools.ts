import { useMemo, useState } from "react";
import type { ConnectorRouting, Rect, Widget, KanbanState, ShapeKind } from "@remo/model";
import type { RailFlyout, RailTool } from "./ToolRail";
import { cardTargetFor } from "./cardTarget";
import { useI18n } from "./i18n";
import { noteFillChoices, noteFillExtras } from "./object-panel/palette";
import { requestImagePicker } from "./imageIntake";
import { armedShapeKind, useArmedTool } from "./useArmedTool";
import {
  rememberedRouting,
  rememberedShapeKind,
  rememberedStickerFill,
  rememberRouting,
  rememberShapeKind,
  rememberStickerFill,
} from "./toolDefaults";

/**
 * The rail's behaviour, in one place (ADR-119, ADR-271).
 *
 * Clicking a tool and pressing its key run the same function, so the two can never
 * drift. A tool without variants creates at once; a shape tool is *armed* instead and
 * waits for the canvas: a drag draws it at size, a click creates the default, Escape
 * puts the rail back to Select. `useArmedTool` is the one state the rail, the keys and
 * the gesture read.
 *
 * The variants a person picks — note fill, shape kind, line type — are remembered in
 * this browser through `toolDefaults`, so the next object is the same kind of object
 * (ADR-266 §10a) without a second settings screen.
 */
export function useBoardTools({
  widgets,
  selectedIds,
  kanbanStates,
  writeBlocked,
  blockedHint,
  canComment,
  canUndo,
  canRedo,
  undo,
  redo,
  canConnect,
  connectSelection,
  createSticky,
  createStickyStack,
  createText,
  createShape,
  createFrame,
  createCard,
  openComment,
  notify,
  setSelectedIds,
  setConnectorRouting,
}: {
  widgets: Widget[];
  selectedIds: readonly string[];
  kanbanStates: Record<string, KanbanState>;
  writeBlocked: boolean;
  /** Why creation is off; the rail and the canvas HUD show it in a tooltip. */
  blockedHint: string;
  canComment: boolean;
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  canConnect: boolean;
  connectSelection: () => void;
  createSticky: (fill?: string) => void;
  createStickyStack: () => void;
  createText: () => void;
  /** Without a box the default shape lands at the centre; with one it is drawn to size. */
  createShape: (kind: ShapeKind, box?: Rect) => void;
  createFrame: () => void;
  createCard: () => boolean;
  openComment: () => void;
  notify: (message: string) => void;
  setSelectedIds: (ids: string[]) => void;
  /** Keep the line type for the next connector too (the app owns `lastConnector`). */
  setConnectorRouting: (routing: ConnectorRouting) => void;
}) {
  const { t } = useI18n();
  const [flyout, setFlyout] = useState<RailFlyout>(null);
  const { armed, arm, disarm, finish } = useArmedTool();
  const [noteFill, setNoteFill] = useState(() => rememberedStickerFill());
  const [routing, setRouting] = useState<ConnectorRouting>(
    () => rememberedRouting() ?? "curved",
  );
  const [shapeKind, setShapeKind] = useState<ShapeKind>(() => rememberedShapeKind());

  /**
   * The fill grid of the colour window, read once: the rail is a shortcut into the same
   * fourteen colours, not a second list (ADR-127).
   */
  const noteColors = useMemo(() => noteFillChoices(), []);
  /** The named chips come from the model list the note window uses (ADR-140). */
  const noteExtras = useMemo(() => noteFillExtras(), []);

  const canAddCard = Boolean(cardTargetFor(widgets, selectedIds, kanbanStates));

  /** Choosing a shape — the rail button, the flyout or a key — arms it (ADR-271). */
  const armShape = (kind: ShapeKind, series = false) => {
    rememberShapeKind(kind);
    setShapeKind(kind);
    arm("shape", kind, series);
    setFlyout(null);
  };

  const cancelArmed = () => disarm();

  const drawShape = (kind: ShapeKind, box: Rect | null) => {
    createShape(kind, box ?? undefined);
    finish();
  };

  const pickSticky = (fill?: string) => {
    if (fill) {
      rememberStickerFill(fill);
      setNoteFill(fill);
    }
    createSticky(fill ?? noteFill);
  };

  const pickRouting = (next: ConnectorRouting) => {
    rememberRouting(next);
    setRouting(next);
    setConnectorRouting(next);
  };

  const run = (tool: RailTool, fill?: string) => {
    switch (tool) {
      case "select":
        disarm();
        setSelectedIds([]);
        break;
      case "sticky":
        pickSticky(fill);
        setFlyout(null);
        break;
      case "sticky-stack":
        createStickyStack();
        break;
      case "text":
        createText();
        break;
      case "image":
        // The picker lives on the canvas: only it knows the camera, so the drop point and
        // the placeholder of a chosen file are in the same place as a dropped one.
        requestImagePicker();
        break;
      case "rectangle":
      case "ellipse":
      case "diamond":
        // The key is both "take the tool" and "make one now": a second press creates the
        // default at the centre, as ADR-119 promised (ADR-271 keeps that).
        if (armedShapeKind(armed) === tool) {
          createShape(tool);
          finish();
        } else {
          armShape(tool);
        }
        break;
      case "connector":
        disarm();
        if (canConnect) connectSelection();
        else notify(t("tool.connectorHint"));
        break;
      case "frame":
        disarm();
        createFrame();
        break;
      case "card":
        disarm();
        if (!createCard()) notify(t("tool.cardHint"));
        break;
      case "comment":
        openComment();
        break;
    }
  };

  const rail = {
    writeBlocked,
    blockedHint,
    canComment,
    flyout,
    onFlyout: setFlyout,
    onSelect: () => run("select"),
    onSticky: (fill?: string) => run("sticky", fill),
    onText: () => run("text"),
    onImage: () => requestImagePicker(),
    onShape: (kind: ShapeKind) => armShape(kind),
    onShapeSeries: (kind: ShapeKind) => armShape(kind, true),
    armedShape: armedShapeKind(armed),
    defaultShape: shapeKind,
    onConnector: () => run("connector"),
    onFrame: () => run("frame"),
    onCard: () => run("card"),
    onComment: () => run("comment"),
    canUndo,
    canRedo,
    onUndo: undo,
    onRedo: redo,
    canConnect,
    canAddCard,
    noteColors,
    noteExtras,
    noteFill,
    connectorRouting: routing,
    onRouting: pickRouting,
  };

  return { rail, run, cancelArmed, drawShape };
}
