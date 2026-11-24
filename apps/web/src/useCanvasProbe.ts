import { useEffect } from "react";
import { pick, placementAt, screenToWorld, textHitAt, type Camera, type KanbanLayout } from "@remo/canvas";
import { DEFAULT_STICKY_SIZE, createWidget, setWidgetText, type BoardDocument, type LineFormatInput, type Presence } from "@remo/doc";
import type { TextDeltaOp, Widget } from "@remo/model";

import type { Gestures } from "./useGestures";
import { paintedProposal } from "./proposalStore";

/**
 * The dev-only probe that lets tests and automation drive the canvas.
 *
 * The board is two `<canvas>` elements, so there are no DOM nodes to target: this
 * exposes the camera, the widget list, the layout, the hit test and the paint counters
 * on `window.__remo` in development builds only. Production ships nothing here.
 */
export interface CursorReadout {
  sessionKey: string;
  /** The name on the plate the painter draws, not the initials. */
  label: string;
  /** Where the spring has the cursor now, in board units. */
  x: number;
  y: number;
  /** 0…1; 0 means the painter skips it. */
  alpha: number;
  /** The peer's latest reported point, which the spring chases. */
  target: { x: number; y: number };
}

/** A note a scenario places with an id of its own (ADR-265 §3.2 turns the id into a tilt). */
export interface SeedNoteInput {
  id: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  text?: string;
  parentId?: string | null;
  style?: { fontSize?: number; fillColor?: string };
}

export function useCanvasProbe({
  boardTitle,
  board,
  camera,
  viewport,
  layouts,
  presence,
  selectedIds,
  connectDraft,
  widgets,
  textOf,
  isCardOfKanban,
  boardRef,
  paintStats,
  cursors,
  setDelta,
  setLineFormat,
}: {
  boardTitle: string;
  camera: Camera;
  viewport: { width: number; height: number };
  layouts: Map<string, KanbanLayout>;
  presence: Presence[];
  selectedIds: readonly string[];
  connectDraft: Gestures["connectDraft"];
  widgets: Widget[];
  textOf: (id: string) => string;
  isCardOfKanban: (widget: Widget) => boolean;
  boardRef: React.RefObject<HTMLCanvasElement | null>;
  paintStats: React.RefObject<Record<string, unknown>>;
  /** Where each peer's cursor is painted now, in board units (ADR-265). */
  cursors: () => CursorReadout[];
  /** The document, so a scenario can place a note with an id of its choosing. */
  board: BoardDocument;
  /** Test automation sets a rich delta without an editor; development builds only. */
  setDelta: (id: string, delta: TextDeltaOp[]) => void;
  /** Test automation sets a line format through the same command the board uses. */
  setLineFormat: (id: string, line: number, format: LineFormatInput | null) => void;
}) {
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as Record<string, unknown>).__remo = {
      /** The plan under review the overlay draws (ADR-188), read at call time. */
      get proposal() {
        return paintedProposal();
      },
      /** Paint counters, read by a scenario that measures the gesture cadence (ADR-213). */
      get paintStats() {
        return paintStats.current;
      },
      boardTitle,
      camera,
      viewport,
      layouts: [...layouts.entries()].map(([id, layout]) => ({
        id,
        left: layout.left,
        top: layout.top,
        width: layout.width,
        height: layout.height,
        headerHeight: layout.headerHeight,
        padding: layout.padding,
        laneStrip: layout.laneStrip,
        columns: layout.columns.map((c) => ({
          id: c.id,
          title: c.title,
          left: c.left,
          centerX: c.centerX,
          width: c.width,
          accent: c.accent,
        })),
        lanes: layout.lanes.map((l) => ({ id: l.id, title: l.title, centerY: l.centerY, top: l.top, height: l.height })),
        placements: layout.placements,
      })),
      presence: presence.map((p) => ({ ...p })),
      /** Where each peer's cursor is drawn now: the spring's position, name and alpha. */
      cursors,
      selectedIds: [...selectedIds],
      connectDraft: connectDraft ? { ...connectDraft } : null,
      widgets: widgets.map((w) => ({
        id: w.id,
        type: w.type,
        parentId: w.parentId,
        x: w.x,
        y: w.y,
        width: w.width,
        height: w.height,
        style: w.style ? { ...w.style } : null,
        title: w.title ?? null,
        shapeKind: w.shapeKind ?? null,
        arrow: w.arrow ?? null,
        routing: w.routing ?? null,
        start: w.start?.item ?? null,
        end: w.end?.item ?? null,
        text: textOf(w.id),
        link: w.link ?? null,
        status: w.status ?? null,
        assigneeId: w.assigneeId ?? null,
        assigneeName: w.assigneeName ?? null,
        startAt: w.startAt ?? null,
        dueAt: w.dueAt ?? null,
        tagIds: w.tagIds ?? null,
        cell: w.cell ? { ...w.cell } : null,
        layout: w.layout ?? null,
        // An image object's own fields (ADR-249): a scenario asserts the picture, the
        // description and the size without reaching into the Yjs document.
        fileId: w.fileId ?? null,
        naturalWidth: w.naturalWidth ?? null,
        naturalHeight: w.naturalHeight ?? null,
        dominantColor: w.dominantColor ?? null,
        alt: w.alt ?? null,
        // The block view a scenario asserts against: the painter sees the same lines.
        lines: w.lines ?? null,
        // Inline marks, so a scenario can assert a link or code without the DOM.
        runs: w.runs ?? null,
      })),
      /** Paint counters: shows that cursor traffic never repaints the board layer. */
      perf: () => ({ ...paintStats.current }),
      /**
       * Set block text from a scenario.
       *
       * The editor's line-format tools arrive in a later stage (ADR-252 §11), so the
       * visual baselines of this stage seed the document through the same delta and
       * command the future toolbar will call.
       */
      setDelta: (id: string, delta: TextDeltaOp[]) => setDelta(id, delta),
      setLineFormat: (id: string, line: number, format: LineFormatInput | null) =>
        setLineFormat(id, line, format),
      /**
       * Place a sticky note with the id the scenario chose.
       *
       * Visual baselines compare pixels, and a note's tilt comes from its id (ADR-265
       * §3.2): a random id would photograph the same screen differently on every run.
       * This is the same document write the UI makes, so the note syncs and survives a
       * reload; only the id is chosen by the test.
       */
      seedNote(input: SeedNoteInput) {
        createWidget(board, {
          id: input.id,
          type: "sticky_note",
          parentId: input.parentId ?? null,
          x: input.x,
          y: input.y,
          width: input.width ?? DEFAULT_STICKY_SIZE.width,
          height: input.height ?? DEFAULT_STICKY_SIZE.height,
          ...(input.style ? { style: input.style } : {}),
        });
        if (input.text) setWidgetText(board, input.id, input.text);
      },
      /** Mirrors the handlers: client coords → what would be hit. */
      probe(clientX: number, clientY: number) {
        const rect = boardRef.current?.getBoundingClientRect();
        if (!rect) return { err: "no canvas" };
        const world = screenToWorld(
          camera,
          { x: 0, y: 0, width: rect.width, height: rect.height },
          { x: clientX - rect.left, y: clientY - rect.top },
        );
        const hitCard = (() => {
          for (const [kanbanId, layout] of layouts) {
            const placement = placementAt(layout, world);
            if (placement) return { kanbanId, placement };
          }
          return null;
        })();
        return {
          rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
          world,
          card: hitCard ? { cardId: hitCard.placement.cardId } : null,
          widget: pick(widgets, world, isCardOfKanban)?.id ?? null,
          // What block text would answer at this point: a checkbox or a link, or null
          // for the object's ordinary behaviour. Used by the browser scenarios.
          text: (() => {
            const under = pick(widgets, world, isCardOfKanban);
            return under ? textHitAt(under, world) : null;
          })(),
        };
      },
    };
  }, [
    board,
    boardTitle,
    camera,
    connectDraft,
    isCardOfKanban,
    layouts,
    presence,
    selectedIds,
    textOf,
    viewport,
    widgets,
    boardRef,
    paintStats,
    cursors,
    setDelta,
    setLineFormat,
  ]);
}
