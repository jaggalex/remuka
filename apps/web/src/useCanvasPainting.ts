import type { Tag } from "@remo/model";
import { CursorMotion } from "./cursorMotion";
import { ObjectHand } from "./objectHand";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  prepareLayer,
  paintBoardLayer,
  paintOverlayLayer,
  type BoardPaintInput,
  type OverlayPaintInput,
} from "./painters";
import { canvasPaletteFromTokens } from "./canvasPalette";
import { connectorResolver, type ContinuePreview } from "./canvasGeometry";
import { useProposalLayout } from "./proposalStore";
import { imageFieldsOf, imageVariantFallbacks, imageVariantForWidget } from "@remo/canvas";
import { boardImageCache } from "./imageCache";
import type { Camera, KanbanLayout } from "@remo/canvas";
import type { Presence } from "@remo/doc";
import type { KanbanState, Widget } from "@remo/model";
import type { BoardSettings } from "./settings";
import type { GridStyle } from "./BoardCanvas";
import type { TranslationKey } from "./i18n";
import type { Gestures } from "./useGestures";

/**
 * The two canvases: what to paint, and when.
 *
 * The board layer is the document (camera, widgets, selection, drag preview); the overlay
 * layer is everything transient (cursors, marquee, guides, anchors). They are separate so
 * a stream of remote cursors repaints only the overlay.
 *
 * State changes never paint directly: they mark a layer dirty and one animation frame
 * paints whatever is dirty, so a burst of events costs one paint per frame. A timer backs
 * the frame up — an occluded window produces no animation frames and the board would
 * otherwise stay blank.
 */
export function useCanvasPainting({
  boardRef,
  overlayRef,
  viewport,
  camera,
  settings,
  grid,
  widgets,
  layouts,
  cardTitles,
  groupNames,
  tags,
  selectedIds,
  gestures,
  isCardOfKanban,
  presence,
  editingId,
  focusedWaypoint,
  kanbanStates,
  clock,
  presenting,
  continuePreview,
  t,
}: {
  boardRef: React.RefObject<HTMLCanvasElement | null>;
  overlayRef: React.RefObject<HTMLCanvasElement | null>;
  viewport: { width: number; height: number };
  camera: Camera;
  settings: BoardSettings;
  grid: GridStyle;
  widgets: Widget[];
  layouts: Map<string, KanbanLayout>;
  cardTitles: Map<string, string>;
  groupNames: Record<string, string>;
  /** The room's tag vocabulary, painted as chips on a card face (ADR-106). */
  tags: Record<string, Tag>;
  selectedIds: readonly string[];
  /** Everything transient the overlay paints; the hook reads it, never changes it. */
  gestures: Gestures;
  isCardOfKanban: (widget: Widget) => boolean;
  presence: Presence[];
  editingId: string | null;
  focusedWaypoint: { connectorId: string; waypointId: string } | null;
  kanbanStates: Record<string, KanbanState>;
  /** Changes once a second while the shared timer runs; the timer card paints from it. */
  clock: number;
  /** A live presentation hides state marks that are not content (ADR-193). */
  presenting: boolean;
  /** The edge "+" preview; the overlay paints it until the click (ADR-195). */
  continuePreview: ContinuePreview | null;
  t: (key: TranslationKey) => string;
}) {
  const {
    preview,
    dragIds,
    dragGhostIds,
    draggedCardId,
    hoverId,
    hoverAnchor,
    hoverCell,
    connectDraft,
    dragPreview,
    guides,
    marquee,
  } = gestures;

  // Cards resolve their box through the kanban placement (ADR-113), so a connector
  // to a card follows it between columns without a document write.
  const resolveConnector = useMemo(
    () => connectorResolver(widgets, layouts),
    [widgets, layouts],
  );

  // A plan under review is painted over the room (ADR-188).
  const proposal = useProposalLayout(resolveConnector, viewport);

  const paintStats = useRef({
    board: 0,
    overlay: 0,
    lastBoardMs: 0,
    lastOverlayMs: 0,
    schedules: 0,
    flushes: 0,
    /** Last paint failure, so a silent blank canvas is explainable. */
    error: "",
    boardInvalidations: 0,
    lastBoardReason: "",
  });

  /**
   * Canvas colours come from the design-system tokens (ADR-078). Read them once and
   * again on a theme switch: the board is not remounted, so a stale palette would
   * leave the canvas in the previous theme.
   */
  const [palette, setPalette] = useState(canvasPaletteFromTokens);
  useEffect(() => {
    const read = () => setPalette(canvasPaletteFromTokens());
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  /**
   * Canvas text does not wait for a web font: a note painted before Golos Text arrives is
   * measured and drawn in the fallback. Repaint once each batch of faces finishes loading,
   * so wraps and the auto-fitted size are computed with the real letters.
   */
  const [fontsLoaded, setFontsLoaded] = useState(0);
  useEffect(() => {
    const fonts = document.fonts;
    if (!fonts) return;
    let alive = true;
    const bump = () => {
      if (alive) setFontsLoaded((count) => count + 1);
    };
    void fonts.ready.then(bump);
    fonts.addEventListener?.("loadingdone", bump);
    return () => {
      alive = false;
      fonts.removeEventListener?.("loadingdone", bump);
    };
  }, []);

  /** Fonts, text caps, the card placeholder and the canvas palette. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: `fontsLoaded` only triggers a repaint.
  const paintTheme = useMemo(
    () => ({
      fontFamily: settings.text.fontFamily,
      fontCap: settings.notes.fontCap,
      shapeStrokeWidth: settings.shapes.strokeWidth,
      cardPlaceholder: t("kanban.cardPlaceholder"),
      kanbanTitle: t("canvas.kanban"),
      timerExpired: t("facilitation.timer.timeUp"),
      imageUnavailable: t("canvas.imageUnavailable"),
      cardStatus: {
        todo: t("card.status.todo"),
        in_progress: t("card.status.in_progress"),
        done: t("card.status.done"),
      },
      palette,
      tags: new Map(Object.values(tags).map((tag) => [tag.id, tag])),
    }),
    // `fontsLoaded` is not read: a new theme object is what makes both layers repaint.
    [settings, t, palette, fontsLoaded, tags],
  );

  /**
   * The decoded picture for an image object, and the request that will supply it.
   *
   * The callback is reached only for objects that survive the painter's culling, so
   * asking here is also what keeps off-screen pictures from loading. The variant follows
   * the object's size on this screen; a larger one already decoded is not dropped until
   * the smaller arrives, so the picture never blinks back to a placeholder.
   */
  const imageOf = useCallback((widget: Widget): ImageBitmap | null => {
    if (widget.type !== "image") return null;
    const { fileId } = imageFieldsOf(widget);
    if (!fileId) return null;
    const variant = imageVariantForWidget(widget, camera.zoom, window.devicePixelRatio || 1);
    void boardImageCache.load(fileId, variant);
    for (const candidate of imageVariantFallbacks(variant)) {
      const bitmap = boardImageCache.peek(fileId, candidate);
      if (bitmap) return bitmap;
    }
    return null;
  }, [camera.zoom]);

  const imageIsUnavailable = useCallback((widget: Widget): boolean => {
    if (widget.type !== "image") return false;
    const { fileId } = imageFieldsOf(widget);
    if (!fileId) return true;
    const variant = imageVariantForWidget(widget, camera.zoom, window.devicePixelRatio || 1);
    return boardImageCache.status(fileId, variant) === "error";
  }, [camera.zoom]);

  /** Paper in the hand (ADR-265 §4.2): hover lift, drag shadow and the release spring. */
  const objectHand = useRef(new ObjectHand());
  const boardAgain = useRef(false);

  const paintBoard = useCallback(() => {
    const canvas = boardRef.current;
    if (!canvas) return;
    const started = performance.now();
    const ctx = prepareLayer(canvas, viewport);
    if (!ctx) return;
    // Paper in the hand (ADR-265 §4.2): the frame is the clock for hover and settle.
    objectHand.current.update(started, { hoverId, dragIds, calm: motionReduced() });
    const input: BoardPaintInput = {
      ctx,
      camera,
      viewport,
      settings,
      grid,
      widgets,
      layouts,
      cardTitles,
      groupNames,
      selectedIds,
      preview,
      dragIds,
      dragGhostIds,
      draggedCardId,
      resolve: resolveConnector,
      isCardOfKanban,
      theme: paintTheme,
      editingId,
      image: imageOf,
      imageUnavailable: imageIsUnavailable,
      hand: (id) => objectHand.current.handOf(id, started),
    };
    paintBoardLayer(input);
    boardAgain.current = objectHand.current.moving(started);
    paintStats.current.board += 1;
    paintStats.current.lastBoardMs = performance.now() - started;
  }, [
    camera,
    cardTitles,
    dragGhostIds,
    dragIds,
    draggedCardId,
    editingId,
    grid,
    groupNames,
    hoverId,
    isCardOfKanban,
    layouts,
    paintTheme,
    preview,
    selectedIds,
    settings,
    viewport,
    resolveConnector,
    widgets,
    isCardOfKanban,
    imageOf,
    imageIsUnavailable,
  ]);

  /**
   * Remote cursors move on springs (ADR-265, `cursorMotion.ts`). The overlay paint feeds
   * the springs and asks for another frame while any cursor is still travelling; a still
   * room costs nothing, and an idle threshold (dim at 10 s, hide at 60 s) wakes one paint.
   */
  const cursorMotion = useRef(new CursorMotion());
  const cursorWake = useRef<number | null>(null);
  const overlayAgain = useRef(false);
  /** Late-bound: the flush defined below re-schedules itself through these. */
  const scheduleRef = useRef<() => void>(() => {});
  const cursorWakeRef = useRef<() => void>(() => {});

  const paintOverlay = useCallback(() => {
    const canvas = overlayRef.current;
    if (!canvas) return;
    const started = performance.now();
    const ctx = prepareLayer(canvas, viewport);
    if (!ctx) return;
    const reduced = motionReduced();
    cursorMotion.current.ingest(presence, started);
    const motion = cursorMotion.current.step(started, {
      zoom: camera.zoom,
      teleport: (1.5 * Math.max(viewport.width, viewport.height)) / Math.max(camera.zoom, 1e-6),
      reduced,
    });
    // The agent's hull breathes while a person considers it (ADR-265 §4.2).
    const proposalAlpha =
      reduced || !proposal
        ? 1
        : 0.86 + 0.14 * Math.cos((started / 2400) * Math.PI * 2);
    overlayAgain.current = motion.moving || (proposal != null && !reduced);
    if (cursorWake.current != null) window.clearTimeout(cursorWake.current);
    cursorWake.current =
      motion.wakeIn == null ? null : window.setTimeout(() => cursorWakeRef.current(), motion.wakeIn + 20);
    const input: OverlayPaintInput = {
      ctx,
      camera,
      viewport,
      settings,
      layouts,
      widgets,
      isCardOfKanban,
      selectedIds,
      preview,
      editingId,
      hoverId,
      hoverAnchor,
      hoverCell,
      connectDraft,
      dragPreview,
      guides,
      marquee,
      presence,
      resolve: resolveConnector,
      theme: paintTheme,
      focusedWaypoint,
      proposal,
      presenting,
      continuePreview,
      image: imageOf,
      imageUnavailable: imageIsUnavailable,
      cursorAt: (peer) => cursorMotion.current.view(peer.sessionKey, started, reduced),
      proposalAlpha,
    };
    paintOverlayLayer(input);
    paintStats.current.overlay += 1;
    paintStats.current.lastOverlayMs = performance.now() - started;
  }, [
    camera,
    connectDraft,
    dragPreview,
    editingId,
    guides,
    hoverAnchor,
    hoverCell,
    focusedWaypoint,
    hoverId,
    layouts,
    marquee,
    paintTheme,
    presence,
    preview,
    proposal,
    presenting,
    continuePreview,
    selectedIds,
    settings,
    viewport,
    resolveConnector,
    widgets,
    isCardOfKanban,
    imageOf,
    imageIsUnavailable,
  ]);

  /**
   * Coalesced redraw: state changes only mark a layer dirty, and one animation frame
   * paints whatever is dirty. A burst of events (a drag, a stream of remote cursors)
   * therefore costs one paint per frame, not one per event.
   */
  const dirty = useRef({ board: true, overlay: true });
  const frame = useRef<number | null>(null);
  const fallback = useRef<number | null>(null);

  /**
   * Latest painters, so the scheduler below can be identity-stable.
   *
   * Looking the painters up through a ref keeps `invalidate` from changing whenever
   * a cursor moves; otherwise the board-layer effect would re-run on every pointer
   * event and repaint the whole board.
   */
  const painters = useRef({ board: paintBoard, overlay: paintOverlay });
  useEffect(() => {
    painters.current = { board: paintBoard, overlay: paintOverlay };
  }, [paintBoard, paintOverlay]);

  /**
   * Paint whatever is dirty.
   *
   * Scheduled through `requestAnimationFrame` so a burst of events costs one paint
   * per frame. A timer backs it up: a window that is occluded (or a tab the browser
   * has stopped compositing) never produces animation frames, and the board would
   * stay blank until it came back into view.
   */
  const flush = useCallback(() => {
    paintStats.current.flushes += 1;
    if (fallback.current != null) {
      window.clearTimeout(fallback.current);
      fallback.current = null;
    }
    if (frame.current != null) {
      window.cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    try {
      if (dirty.current.board) {
        dirty.current.board = false;
        painters.current.board();
      }
      if (dirty.current.overlay) {
        dirty.current.overlay = false;
        painters.current.overlay();
      }
      // A cursor or a sheet still on its way asks for the next frame (ADR-265).
      if (overlayAgain.current) {
        overlayAgain.current = false;
        dirty.current.overlay = true;
        scheduleRef.current();
      }
      if (boardAgain.current) {
        boardAgain.current = false;
        dirty.current.board = true;
        scheduleRef.current();
      }
    } catch (error) {
      paintStats.current.error = String(error);
      dirty.current.board = true;
      dirty.current.overlay = true;
    }
  }, []);

  const schedulePaint = useCallback(() => {
    paintStats.current.schedules += 1;
    if (frame.current != null) return;
    frame.current = window.requestAnimationFrame(() => {
      frame.current = null;
      flush();
    });
    if (fallback.current == null) {
      fallback.current = window.setTimeout(() => {
        fallback.current = null;
        flush();
      }, 120);
    }
  }, [flush]);

  const invalidate = useCallback(
    (layers: { board?: boolean; overlay?: boolean }) => {
      if (layers.board) dirty.current.board = true;
      if (layers.overlay) dirty.current.overlay = true;
      schedulePaint();
    },
    [schedulePaint],
  );

  const invalidateBoard = useCallback(() => invalidate({ board: true }), [invalidate]);
  const invalidateOverlay = useCallback(() => invalidate({ overlay: true }), [invalidate]);
  scheduleRef.current = schedulePaint;
  cursorWakeRef.current = invalidateOverlay;

  /**
   * A decoded picture is a reason to repaint, and the only one the document cannot
   * announce: nothing in Yjs changed when the bytes arrived. The cache emits once per
   * finished request, so a board of loading pictures costs one paint each, not a loop.
   */
  useEffect(
    () => boardImageCache.subscribe(() => invalidateBoard()),
    [invalidateBoard],
  );

  // Board layer: camera, document, selection.
  const boardDeps = useRef<Record<string, unknown>>({});
  useEffect(() => {
    if (import.meta.env.DEV) {
      const now: Record<string, unknown> = {
        camera,
        widgets,
        kanbanStates,
        selectedIds,
        layouts,
        cardTitles,
        dragIds,
        dragGhostIds,
        draggedCardId,
        preview,
        clock,
        hoverId,
      };
      const changed = Object.keys(now).filter((key) => boardDeps.current[key] !== now[key]);
      boardDeps.current = now;
      paintStats.current.boardInvalidations += 1;
      paintStats.current.lastBoardReason = changed.join(",") || "first";
    }
    invalidateBoard();
  }, [
    invalidateBoard,
    camera,
    widgets,
    kanbanStates,
    selectedIds,
    layouts,
    cardTitles,
    dragIds,
    dragGhostIds,
    draggedCardId,
    preview,
    clock,
    hoverId,
    // The painter is memoized by theme, settings, grid, group names and viewport;
    // invalidating on the painter is what repaints a theme or language change.
    paintBoard,
  ]);

  // Overlay layer: cursors, marquee, drag ghost. Deliberately does not touch the board.
  useEffect(() => {
    invalidateOverlay();
  }, [
    invalidateOverlay,
    presence,
    marquee,
    dragPreview,
    hoverCell,
    hoverId,
    guides,
    connectDraft,
    editingId,
    selectedIds,
    camera,
    viewport,
    preview,
    // Covers hoverAnchor, focusedWaypoint and the theme, which the overlay paints.
    paintOverlay,
  ]);

  useEffect(() => {
    return () => {
      // Cancel *and* clear: leaving a stale id behind makes every later
      // schedulePaint() think a frame is already pending, which silently stops
      // painting for good (StrictMode remounts hit this immediately).
      if (frame.current != null) {
        window.cancelAnimationFrame(frame.current);
        frame.current = null;
      }
      if (fallback.current != null) {
        window.clearTimeout(fallback.current);
        fallback.current = null;
      }
      if (cursorWake.current != null) {
        window.clearTimeout(cursorWake.current);
        cursorWake.current = null;
      }
      objectHand.current.reset();
    };
  }, []);
  /**
   * Where the overlay would draw each peer's cursor right now, in board units.
   *
   * The dev probe needs it: a cursor is a canvas shape, so a browser scenario cannot
   * read it from the DOM, and the spring is the thing under test. The getter steps
   * nothing — it reads the track the last paint left — so sampling cannot change what
   * people see.
   */
  const cursorView = useCallback(
    () =>
      presence.flatMap((peer) => {
        if (peer.self || !peer.cursor) return [];
        const now = performance.now();
        const view = cursorMotion.current.view(peer.sessionKey, now, motionReduced());
        return view
          ? [{ sessionKey: peer.sessionKey, label: peer.label ?? peer.name, ...view, target: { ...peer.cursor } }]
          : [];
      }),
    [presence],
  );

  // The palette is the canvas's theme resolved from tokens; DOM layers over the canvas
  // (the inline editor, the header fields) read the same one, or their text would be the
  // theme's rather than the ink of the surface under them (ADR-273 §2.4).
  return { invalidateBoard, invalidateOverlay, paintStats, cursorView, palette };
}

/** prefers-reduced-motion, or "calm animations" in the account settings (ADR-265). */
function motionReduced(): boolean {
  if (typeof document !== "undefined" && document.documentElement.dataset.motion === "calm") return true;
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
}
