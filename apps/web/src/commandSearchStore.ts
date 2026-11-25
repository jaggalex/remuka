import { useSyncExternalStore } from "react";

/**
 * Whether the command search is open, for every control that can open it.
 *
 * The bottom panel lives inside the canvas, the hot key lives in the keyboard hook, the
 * menu rows live in the registry; the dialog itself is mounted once, next to the other
 * room overlays. A tiny store is what lets all four open the same dialog without each of
 * them owning a copy of its state (ADR-266 §1.2).
 */
let open = false;
let opener: HTMLElement | null = null;
const listeners = new Set<() => void>();

function publish(): void {
  for (const listener of listeners) listener();
}

/**
 * Open the search. `returnTo` is the control that should get focus back: a menu row is
 * removed when its menu closes, so the account menu names its trigger instead.
 */
export function openCommandSearch(returnTo?: HTMLElement | null): void {
  if (open) return;
  opener = returnTo ?? (document.activeElement as HTMLElement | null);
  open = true;
  publish();
}

export function closeCommandSearch(): void {
  if (!open) return;
  open = false;
  publish();
}

/** The control captured when the search opened; the palette focuses it on close. */
export function commandSearchOpener(): HTMLElement | null {
  return opener;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const isOpen = (): boolean => open;

/** The flag as React state; no component keeps a second copy. */
export function useCommandSearchOpen(): boolean {
  return useSyncExternalStore(subscribe, isOpen, isOpen);
}
