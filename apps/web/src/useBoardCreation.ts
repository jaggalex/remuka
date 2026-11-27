/**
 * Creation commands: the rail's actions and the objects they add (ADR-119).
 *
 * Split out of `useBoardCommands` so the style and clipboard halves stay readable and
 * each new creation tool has one obvious home.
 */
import { useCallback, useMemo, useRef } from "react";
import type { BoardDocument } from "@remo/doc";
import {
  addCard,
  addColumn,
  createKanban,
  createShape,
  createSticky,
  createText,
  createWidget,
} from "@remo/doc";
import {
  canConnect,
  newId,
  reconstructKanban,
  type KanbanState,
  type ShapeKind,
  type Widget,
  type Vec2,
} from "@remo/model";
import { cardTargetFor } from "./cardTarget";
import { rememberedStickerFill } from "./toolDefaults";
import { setSectionView } from "./sectionView";
import type { TranslationKey } from "./i18n";
import type { BoardSettings } from "./settings";
import { cameraStore } from "./cameraStore";

/** A new card's box, matched to the template the matrix was captured from. */
const CARD_WIDTH = 422.08;
const CARD_HEIGHT = 79.14;

export function useBoardCreation({
  board,
  widgets,
  selectedIds,
  kanbanStates,
  settings,
  setSelectedIds,
  startEditing,
  t,
  lang,
}: {
  board: BoardDocument;
  widgets: Widget[];
  selectedIds: string[];
  kanbanStates: Record<string, KanbanState>;
  settings: BoardSettings;
  setSelectedIds: (ids: string[]) => void;
  /** Open the inline editor for a newly created card (ADR-169). */
  startEditing?: (id: string) => void;
  /** Words for a new section's title and the table's placeholder axes. */
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
  lang: "en" | "ru";
}) {
  /** Cascade counter so consecutive additions do not land on one point. */
  const placedCount = useRef(0);

  const onAddCard = useCallback(
    (kanbanId: string, columnId: string, swimlaneId: string) => {
      const id = newId("card");
      addCard(
        board,
        kanbanId,
        id,
        {
          id,
          type: "card",
          parentId: kanbanId,
          x: 0,
          y: 0,
          width: CARD_WIDTH,
          height: CARD_HEIGHT,
          title: "",
        },
        columnId,
        swimlaneId,
      );
      setSelectedIds([id]);
      startEditing?.(id);
    },
    [board, setSelectedIds, startEditing],
  );

  const onAddColumn = useCallback(
    (kanbanId: string) => addColumn(board, kanbanId),
    [board],
  );

  /** New objects land near the middle of the view, cascading so they do not stack. */
  const nextSpot = useCallback(() => {
    const step = placedCount.current % 6;
    placedCount.current += 1;
    // Read the live viewport when the object is created, not a render-time copy.
    const camera = cameraStore.get();
    return { x: camera.x - 200 + step * 40, y: camera.y - 150 + step * 40 };
  }, []);

  const addSticky = useCallback(
    (fill?: string, at?: Vec2): string => {
      const id = newId("sticky");
      // A note created with no choice gets the design system's yellow, so the first chip
      // in its bar is the colour it actually has. Existing notes keep their hex (ADR-120).
      createSticky(board, id, at ?? nextSpot(), fill ?? rememberedStickerFill());
      setSelectedIds([id]);
      return id;
    },
    [board, nextSpot, setSelectedIds],
  );

  /** Shift+N: a small pad of notes, laid out in a grid and selected together. */
  const addStickyStack = useCallback(
    (count = 5) => {
      const spot = nextSpot();
      const ids: string[] = [];
      for (let index = 0; index < count; index += 1) {
        const id = newId("sticky");
        const column = index % 3;
        const row = Math.floor(index / 3);
        createSticky(
          board,
          id,
          { x: spot.x + column * 220, y: spot.y + row * 220 },
          rememberedStickerFill(),
        );
        ids.push(id);
      }
      setSelectedIds(ids);
    },
    [board, nextSpot, setSelectedIds],
  );

  /** A text object: the rail creates it empty and the editor opens over it. */
  const addText = useCallback((at?: Vec2): string => {
    const id = newId("text");
    const spot = at ?? nextSpot();
    // No colour is written: new text is "Auto" and takes its ink from the surface it
    // lands on (ADR-273 §2.3). The old grey 600 reads as Auto too.
    createText(board, id, spot);
    setSelectedIds([id]);
    return id;
  }, [board, nextSpot, setSelectedIds]);

  /** A card lives in a kanban cell, so the rail needs a target or an explanation. */
  const addCardFromSelection = useCallback((): boolean => {
    const target = cardTargetFor(widgets, selectedIds, kanbanStates);
    if (!target) return false;
    onAddCard(target.kanbanId, target.columnId, target.swimlaneId);
    return true;
  }, [widgets, selectedIds, kanbanStates, onAddCard]);

  /** Exactly two connectable objects: the rail's connector tool needs nothing else. */
  const canJoinSelection = useMemo(
    () =>
      selectedIds.length === 2 &&
      selectedIds.every((id) => {
        const widget = widgets.find((entry) => entry.id === id);
        return widget ? canConnect(widget) : false;
      }),
    [selectedIds, widgets],
  );

  const addFrame = useCallback(
    (title: string, view: "free" | "table" = "free") => {
      const id = newId("frame");
      const spot = nextSpot();
      board.transact(() => {
        createWidget(board, {
          id,
          type: "frame",
          parentId: null,
          x: spot.x,
          y: spot.y,
          width: 640,
          height: 420,
          title,
          ...(view === "table" && { layout: { kind: "table", rows: [], columns: [] } }),
        });
        if (view === "table") setSectionView(board, id, view, t);
      });
      setSelectedIds([id]);
      return id;
    },
    [board, nextSpot, setSelectedIds, t],
  );

  const addShape = useCallback(
    (kind: ShapeKind, box?: { x: number; y: number; width: number; height: number }, centre?: Vec2) => {
      const id = newId("shape");
      const at = box
        ? { x: box.x + box.width / 2, y: box.y + box.height / 2 }
        : centre ?? nextSpot();
      createShape(board, id, kind, at, {
        fillColor: settings.shapes.fill,
        strokeColor: settings.shapes.stroke,
        strokeWidth: settings.shapes.strokeWidth,
      }, box ? { width: box.width, height: box.height } : undefined);
      setSelectedIds([id]);
      return id;
    },
    [board, nextSpot, setSelectedIds, settings.shapes.fill, settings.shapes.stroke, settings.shapes.strokeWidth],
  );

  /**
   * «More → Table»: a section that is a table from the first click.
   *
   * One creation path, the same `setSectionView` the panel uses: the first column also
   * makes the row axis, and the table is never a second kind of object (ADR-196).
   */
  const addTable = useCallback(
    () => addFrame(t("section.view.table"), "table"),
    [addFrame, t],
  );

  /** «More → Kanban»: an empty three-column board, ready for cards. */
  const addKanban = useCallback((): string => {
    const id = newId("kanban");
    const spot = nextSpot();
    const widget: Widget = {
      id,
      type: "kanban",
      parentId: null,
      x: spot.x,
      y: spot.y,
      width: 1149.2,
      height: 720,
    };
    const state = reconstructKanban("kanban-framework", widget, [], lang);
    createKanban(board, id, spot, state);
    setSelectedIds([id]);
    return id;
  }, [board, lang, nextSpot, setSelectedIds]);

  return {
    onAddCard,
    onAddColumn,
    nextSpot,
    addSticky,
    addStickyStack,
    addText,
    addCardFromSelection,
    canJoinSelection,
    addFrame,
    addShape,
    addTable,
    addKanban,
  };
}
