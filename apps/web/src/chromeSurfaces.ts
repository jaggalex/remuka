import { useEffect, useRef, useSyncExternalStore } from "react";
import type { ChromeAbility, ChromeContext } from "./commands";

/**
 * One dispatcher for the chrome commands, whichever menu owns the action (T7).
 *
 * The room menu builds its handlers in `BoardTopbar`, the account menu in
 * `AccountMenu`; each knows which dialog or panel its rows open. The search is a third
 * surface over the same registry, so it asks this small table instead of holding a
 * second copy of every handler. The sets are disjoint — a row has one intent and one
 * menu — so dispatching to each registered surface runs exactly the owner.
 */
interface Surface {
  get: () => ChromeContext;
}

const surfaces = new Map<string, Surface>();
const listeners = new Set<() => void>();

export interface ChromeSurfaceSnapshot {
  can: Partial<Record<ChromeAbility, boolean>>;
  run: (id: string) => void;
}

let snapshot: ChromeSurfaceSnapshot = { can: {}, run: () => undefined };

/** A stable key for "what this surface allows right now": a re-render with the same
 * flags must not wake the dialog. */
function abilitiesKey(ctx: ChromeContext): string {
  return Object.entries(ctx.can)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => `${name}:${value === true ? 1 : 0}`)
    .join("|");
}

function refresh(): void {
  const can: Partial<Record<ChromeAbility, boolean>> = {};
  for (const surface of surfaces.values()) {
    for (const [name, value] of Object.entries(surface.get().can)) {
      const ability = name as ChromeAbility;
      // A surface that knows the true answer wins over one that only knows the false one.
      if (value === true) can[ability] = true;
      else if (!(ability in can)) can[ability] = false;
    }
  }
  snapshot = {
    can,
    run: (id) => {
      for (const surface of surfaces.values()) surface.get().run(id);
    },
  };
  for (const listener of listeners) listener();
}

function register(id: string, get: () => ChromeContext): () => void {
  surfaces.set(id, { get });
  refresh();
  return () => {
    if (surfaces.get(id)?.get !== get) return;
    surfaces.delete(id);
    refresh();
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const current = (): ChromeSurfaceSnapshot => snapshot;

/** The merged context, for a surface that is not one of the menus (the search). */
export function useChromeSurface(): ChromeSurfaceSnapshot {
  return useSyncExternalStore(subscribe, current, current);
}

/**
 * Register a menu's handlers while it is mounted. The context is read through a ref so a
 * new closure on every render does not re-register; only a change in what is allowed does.
 */
export function useChromeSurfaceRegistration(id: string, ctx: ChromeContext): void {
  const latest = useRef(ctx);
  latest.current = ctx;
  const key = abilitiesKey(ctx);
  useEffect(() => register(id, () => latest.current), [id, key]);
}
