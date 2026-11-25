import { useEffect, useRef, useSyncExternalStore } from "react";

/**
 * Chrome steps back while a canvas gesture runs (ADR-266 §7, ADR-289).
 *
 * The header, the tool rail and the bottom HUD fade to 35 % and stop taking the pointer
 * after a gesture has lasted 150 ms, and return 200 ms after it ends. Only pointer
 * gestures publish this: keyboard work never does, an open menu or dialog cancels it,
 * and calm animations make the change instant through CSS.
 */
export const QUIET_AFTER_MS = 150;
export const QUIET_BACK_MS = 200;

let quiet = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function isChromeQuiet(): boolean {
  return quiet;
}

export function setChromeQuiet(value: boolean): void {
  if (quiet === value) return;
  quiet = value;
  emit();
}

/** A click belongs to the gesture while a menu or a dialog is open: do not take it away. */
function overlayOpen(): boolean {
  if (typeof document === "undefined") return false;
  return Boolean(document.querySelector(".rm-popover, .rm-menu, [role='dialog']"));
}

/** What a chrome container reads to put `.is-quiet` on itself. */
export function useChromeQuiet(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => quiet,
    () => false,
  );
}

/** The single publisher: the gesture machine in `useGestures` calls it. */
export function useQuietWhileGesturing(active: boolean): void {
  const enter = useRef<number | null>(null);
  const leave = useRef<number | null>(null);

  useEffect(() => {
    if (active) {
      if (leave.current !== null) {
        window.clearTimeout(leave.current);
        leave.current = null;
      }
      if (quiet || enter.current !== null) return;
      enter.current = window.setTimeout(() => {
        enter.current = null;
        if (!overlayOpen()) setChromeQuiet(true);
      }, QUIET_AFTER_MS);
      return;
    }
    if (enter.current !== null) {
      window.clearTimeout(enter.current);
      enter.current = null;
    }
    if (!quiet || leave.current !== null) return;
    leave.current = window.setTimeout(() => {
      leave.current = null;
      setChromeQuiet(false);
    }, QUIET_BACK_MS);
  }, [active]);

  useEffect(
    () => () => {
      if (enter.current !== null) window.clearTimeout(enter.current);
      if (leave.current !== null) window.clearTimeout(leave.current);
      setChromeQuiet(false);
    },
    [],
  );
}
