import { useEffect, useMemo, useRef, useSyncExternalStore, type RefObject } from "react";
import {
  fitToBounds,
  proposalLayout,
  type ProposalLayout,
  type ProposalPlan,
} from "@remo/canvas";
import type { Widget } from "@remo/model";
import { cameraStore } from "./cameraStore";

/**
 * The plan under review, shared between the task panel and the canvas (ADR-188).
 *
 * The panel lives in the dialog tree and the canvas in the board tree; neither should
 * re-render the other's ancestors, so the plan sits outside React like the camera does.
 * The panel publishes what it shows and clears it when it closes; the overlay paints it.
 * Nothing here touches the document.
 */
export interface ProposalPreview {
  /** Changes when the plan changes (a new task, a relayout): the canvas refits once. */
  key: string;
  plan: ProposalPlan;
  kind: "tidy" | "agent";
  /** Screen pixels the panel covers at the bottom; the fit keeps the plan above it. */
  bottomInset: number;
  /** Screen pixels taken by the right-hand review panel on larger viewports. */
  rightInset: number;
}

class ProposalStore {
  private value: ProposalPreview | null = null;
  private listeners = new Set<() => void>();

  get = (): ProposalPreview | null => this.value;

  set = (next: ProposalPreview | null): void => {
    if (next === this.value) return;
    this.value = next;
    for (const listener of this.listeners) listener();
  };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}

export const proposalStore = new ProposalStore();

/** The layout the overlay last painted, for the dev probe (`window.__remo.proposal`). */
let painted: ProposalLayout | null = null;
export function paintedProposal(): ProposalLayout | null {
  return painted;
}

/** Fit both the starting positions and the Tidy targets inside the exposed canvas. */
export function fitTidyPreview(canvas: Element | null): boolean {
  if (!canvas || proposalStore.get()?.kind !== "tidy" || !painted?.bounds) return false;
  const surface = canvas.getBoundingClientRect();
  const panel = document.querySelector(".agent-task-panel[data-tidy]")?.getBoundingClientRect();
  if (!panel || !surface.width || !surface.height) return false;
  const rail = canvas.parentElement?.querySelector(".tool-rail-panel")?.getBoundingClientRect();
  const hud = canvas.querySelector(".canvas-hud")?.getBoundingClientRect();
  const sheet = panel.left <= surface.left + 1 && panel.right >= surface.right - 1;
  const right = sheet ? surface.right : Math.min(surface.right, panel.left);
  const bottom = Math.min(surface.bottom, sheet ? panel.top : surface.bottom, hud?.height ? hud.top : surface.bottom);
  const left = rail?.width && rail.top < bottom && rail.bottom > surface.top
    ? Math.max(surface.left, rail.right) : surface.left;
  const width = right - left;
  const height = bottom - surface.top;
  if (width <= 0 || height <= 0) return false;
  const bounds = painted.bounds;
  const camera = fitToBounds({ ...bounds, width: Math.max(1, bounds.width), height: Math.max(1, bounds.height) },
    { x: 0, y: 0, width, height }, 0.85);
  const zoom = Math.min(1, camera.zoom);
  cameraStore.set({
    x: camera.x + (surface.left + surface.right - left - right) / (2 * zoom),
    y: camera.y + (surface.bottom - bottom) / (2 * zoom),
    zoom,
  }, "fit");
  return true;
}

export function useProposal(): ProposalPreview | null {
  return useSyncExternalStore(proposalStore.subscribe, proposalStore.get, proposalStore.get);
}

const NO_SELECTION: readonly string[] = [];

/** Tidy owns the preview surface. Preserve the real selection for Cancel and retry. */
export function useVisibleSelection(selectedIds: readonly string[]): readonly string[] {
  return useProposal()?.kind === "tidy" ? NO_SELECTION : selectedIds;
}

/**
 * The layout the overlay paints, and one camera fit per plan.
 *
 * The fit happens when a plan first appears (or is laid out again), never on later room
 * edits: a person who panned away keeps their camera. The plan is framed in the part of
 * the canvas the panel does not cover.
 */
export function useProposalLayout(
  resolve: (id: string) => Widget | undefined,
  viewport: { width: number; height: number },
  overlayRef: RefObject<HTMLCanvasElement | null>,
): ProposalLayout | null {
  const proposal = useProposal();
  const layout = useMemo(
    () => (proposal ? proposalLayout(proposal.plan, resolve, proposal.kind === "tidy") : null),
    [proposal, resolve],
  );
  painted = layout;
  const fitted = useRef<string | null>(null);
  useEffect(() => {
    if (!proposal) {
      fitted.current = null;
      return;
    }
    if (fitted.current === proposal.key || !layout?.bounds) return;
    if (!viewport.width || !viewport.height) return;
    if (fitTidyPreview(overlayRef.current?.parentElement ?? null)) {
      fitted.current = proposal.key;
      return;
    }
    const height = Math.max(1, viewport.height - proposal.bottomInset);
    const width = Math.max(1, viewport.width - proposal.rightInset);
    const camera = fitToBounds(
      {
        ...layout.bounds,
        width: Math.max(layout.bounds.width, 1),
        height: Math.max(layout.bounds.height, 1),
      },
      { x: 0, y: 0, width, height },
      0.85,
    );
    // Never zoom in past 100 %: two small notes would fill the screen and lose the room.
    camera.zoom = Math.min(camera.zoom, 1);
    // The canvas camera is centred on the full viewport. Move the plan into the
    // visible part to the left of the rail or above the mobile sheet.
    cameraStore.set({
      ...camera,
      x: camera.x + (viewport.width - width) / (2 * camera.zoom),
      y: camera.y + (viewport.height - height) / (2 * camera.zoom),
    }, "fit");
    fitted.current = proposal.key;
  }, [proposal, layout, viewport.width, viewport.height, overlayRef]);
  return layout;
}
