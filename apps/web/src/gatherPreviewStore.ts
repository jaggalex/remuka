import { useSyncExternalStore } from "react";

/**
 * The "future section" outline, shared by two surfaces (ADR-198, T8).
 *
 * The gather action moved from the multi-selection bar into the properties panel, but the
 * preview is painted by the canvas. A four-line external store keeps the one boolean out
 * of `BoardApp`'s props and lets the panel's button point at the same outline the bar
 * used to point at.
 */
let on = false;
const listeners = new Set<() => void>();

export function setGatherPreview(next: boolean): void {
  if (on === next) return;
  on = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useGatherPreview(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => on,
    () => on,
  );
}
