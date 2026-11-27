import { describe, expect, it, vi } from "vitest";
import type { GestureEnv } from "./gestureEnv";
import { pointerCancel, pointerUp } from "./gesturePointerUp";

function columnGesture(moved: boolean) {
  const drag = { mode: "kanbanAxis", kind: "column", kanbanId: "board", id: "a", from: 0,
    start: { x: 40, y: 10 }, last: { x: moved ? 180 : 40, y: 10 }, moved };
  const env = {
    dragRef: { current: drag }, anchorPressRef: { current: null }, connectDraftRef: { current: null },
    cardPreviewRef: { current: null }, marqueeRef: { current: null }, dragDeltaRef: { current: null },
    layouts: new Map([["board", { columns: [
      { id: "a", left: 0, width: 100, centerX: 50 }, { id: "b", left: 100, width: 100, centerX: 150 },
    ] }]]),
    onMoveKanbanAxis: vi.fn(), onColumnTitleClick: vi.fn(), worldToScreenPoint: (point: unknown) => point,
    clearPreview: vi.fn(), setGuides: vi.fn(), setConnectDraft: vi.fn(), setShapeDraft: vi.fn(),
    setRotationDraft: vi.fn(), setResizeLimit: vi.fn(), setTableHover: vi.fn(), setTableRefused: vi.fn(),
    setDragPreview: vi.fn(), setHoverCell: vi.fn(), setMarquee: vi.fn(), setDragIds: vi.fn(), setDragGhostIds: vi.fn(),
  };
  return { observed: env, env: env as unknown as GestureEnv };
}

describe("cancelling a column header gesture", () => {
  it.each([false, true])("discards both the click and the drop (moved=%s)", moved => {
    const { env, observed } = columnGesture(moved);
    const capture = { hasPointerCapture: vi.fn(() => true), releasePointerCapture: vi.fn() };
    pointerCancel(env, { pointerId: 7, target: capture } as unknown as React.PointerEvent<HTMLElement>);
    expect(observed.dragRef.current).toBeNull();
    expect(observed.clearPreview).toHaveBeenCalledOnce();
    expect(observed.setGuides).toHaveBeenCalledWith([]);
    expect(capture.releasePointerCapture).toHaveBeenCalledWith(7);
    pointerUp(env);
    expect(observed.onMoveKanbanAxis).not.toHaveBeenCalled();
    expect(observed.onColumnTitleClick).not.toHaveBeenCalled();
  });

  it("still opens a clicked column and reorders a dropped column exactly once", () => {
    const click = columnGesture(false);
    pointerUp(click.env);
    expect(click.observed.onColumnTitleClick).toHaveBeenCalledOnce();
    expect(click.observed.onMoveKanbanAxis).not.toHaveBeenCalled();
    const drop = columnGesture(true);
    pointerUp(drop.env);
    expect(drop.observed.onMoveKanbanAxis).toHaveBeenCalledExactlyOnceWith("board", "column", "a", 1);
    expect(drop.observed.onColumnTitleClick).not.toHaveBeenCalled();
  });
});
