import { useSyncExternalStore } from "react";

/**
 * The frame whose label is being renamed (ADR-267).
 *
 * A double click on the painted label is a canvas gesture, but the field belongs to
 * `SectionTitleLayer`, the one "Rename section" control. This tiny channel lets the
 * gesture ask that control to open, without a second editor and without the canvas
 * learning about DOM.
 */
let value: string | null = null;
const listeners = new Set<() => void>();

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function openFrameLabelEdit(frameId: string): void {
  value = frameId;
  for (const listener of listeners) listener();
}

export function closeFrameLabelEdit(): void {
  if (!value) return;
  value = null;
  for (const listener of listeners) listener();
}

export function useFrameLabelEdit(): string | null {
  return useSyncExternalStore(subscribe, () => value, () => null);
}
