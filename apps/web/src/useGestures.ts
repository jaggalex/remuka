import type { GestureEnv } from "./gestureEnv";
import { useGestureEnv } from "./gestureEnv";
import { pointerDown } from "./gesturePointerDown";
import { pointerMove } from "./gesturePointerMove";
import { pointerCancel, pointerUp } from "./gesturePointerUp";
import { doubleClick } from "./gestureDoubleClick";
import type { GestureDeps, Gestures } from "./gestureTypes";
import { useQuietWhileGesturing } from "./quietChrome";

export type { GestureDeps, Gestures, ConnectDraft } from "./gestureTypes";

/**
 * The pointer state machine: what a press, a drag and a release mean (ADR-059).
 *
 * The shared state lives in `useGestureEnv`, each phase of a gesture is a plain function
 * of that state and the event, and this hook only wires them together: one gesture, one
 * file to read.
 */
export function useGestures(deps: GestureDeps): Gestures {
  const env: GestureEnv = useGestureEnv(deps);
  // One publisher for quiet chrome (ADR-266 §7): the gesture states, not the callers.
  useQuietWhileGesturing(
    env.dragIds.length > 0 ||
      env.preview.size > 0 ||
      env.marquee !== null ||
      env.shapeDraft !== null ||
      env.connectDraft !== null ||
      env.rotationDraft !== null ||
      env.dragPreview !== null,
  );
  return {
    cursor: env.cursor,
    dragPreview: env.dragPreview,
    draggedCardId: env.dragPreview?.cardId ?? null,
    hoverCell: env.hoverCell,
    tableHover: env.tableHover,
    tableRefused: env.tableRefused,
    marquee: env.marquee,
    shapeDraft: env.shapeDraft,
    rotationDraft: env.rotationDraft,
    rotationHover: env.rotationHover,
    preview: env.preview,
    dragIds: env.dragIds,
    dragGhostIds: env.dragGhostIds,
    guides: env.guides,
    resizeLimit: env.resizeLimit,
    setResizeLimit: env.setResizeLimit,
    hoverId: env.hoverId,
    connectDraft: env.connectDraft,
    hoverAnchor: env.hoverAnchor,
    resolve: env.widgetById,
    clearHover: () => {
      env.setHoverId(null);
      env.setHoverAnchor(null);
    },
    onPointerDown: (event) => pointerDown(env, event),
    onPointerMove: (event) => pointerMove(env, event),
    onPointerUp: () => pointerUp(env),
    onPointerCancel: event => pointerCancel(env, event),
    onDoubleClick: (event) => doubleClick(env, event),
    startConnect: (fromId, side, client) => {
      // The press already travelled past the click threshold on the "+", so this is a
      // drag from the start; a release then draws the line or ends nowhere.
      env.anchorPressRef.current = { fromId, side, x: client.x, y: client.y, moved: true };
      env.dragRef.current = { mode: "connect", fromId, fromSide: side };
      const world = env.toWorld({ clientX: client.x, clientY: client.y } as React.PointerEvent<HTMLCanvasElement>);
      env.connectDraftRef.current = { fromId, fromSide: side, x: world.x, y: world.y };
      env.setConnectDraft(env.connectDraftRef.current);
    },
  };
}
