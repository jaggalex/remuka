import { HINT_REGISTRY, hintDefinition, type HintId } from "./hintRegistry";

/**
 * What one browser has learned about hints (ADR-266 §6, ADR-289).
 *
 * The state lives only here: `localStorage` under `remuka.hints.<id>` as
 * `{"done":n,"visits":n}`. The functions take a storage so the rule can be tested
 * without a browser; the UI reads them through `useOnceHint`.
 */
export const HINT_KEY_PREFIX = "remuka.hints.";

/**
 * The one pre-registry flag. It is spelled here as a literal on purpose: the browser
 * storage gate reads keys it can resolve (ADR-289, `spec/cookies.md` §2).
 */
const LEGACY_CANVAS_HINT = "remo.canvas.hint";

export interface HintRecord {
  /** How many times the action the hint teaches has been used. */
  done: number;
  /** How many visits the hint had a chance to be seen. */
  visits: number;
}

export type HintStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function browserStorage(): HintStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function keyOf(id: string): string {
  return `${HINT_KEY_PREFIX}${id}`;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

function parse(raw: string | null): HintRecord | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as { done?: unknown; visits?: unknown };
    return { done: count(value.done), visits: count(value.visits) };
  } catch {
    return null;
  }
}

/** The learned state of one hint; a legacy "seen" key counts as fully learned. */
export function readHint(
  id: HintId,
  storage: HintStorage | null = browserStorage(),
): HintRecord {
  const definition = hintDefinition(id);
  const stored = parse(storage?.getItem(keyOf(id)) ?? null) ?? { done: 0, visits: 0 };
  // The old one-visit key wins over a fresh count: a person who dismissed the plate
  // before this mechanism existed must not see it again (ADR-289).
  if (definition.legacyKey === LEGACY_CANVAS_HINT && storage?.getItem(LEGACY_CANVAS_HINT) === "seen") {
    return { done: Math.max(stored.done, definition.doneAfter), visits: stored.visits };
  }
  return stored;
}

export function hintLearned(
  id: HintId,
  storage: HintStorage | null = browserStorage(),
): boolean {
  const definition = hintDefinition(id);
  const record = readHint(id, storage);
  return record.done >= definition.doneAfter || record.visits >= definition.maxSessions;
}

function write(id: HintId, record: HintRecord, storage: HintStorage | null): HintRecord {
  try {
    storage?.setItem(keyOf(id), JSON.stringify(record));
  } catch {
    /* private mode: the hint simply comes back next time, which is harmless */
  }
  notify();
  return record;
}

/** The action happened: count it, and the plate goes away at `doneAfter`. */
export function markHintDone(
  id: HintId,
  storage: HintStorage | null = browserStorage(),
): HintRecord {
  const record = readHint(id, storage);
  return write(id, { ...record, done: record.done + 1 }, storage);
}

/** A visit where this hint could be seen; past `maxSessions` it is never shown again. */
export function markHintVisit(
  id: HintId,
  storage: HintStorage | null = browserStorage(),
): HintRecord {
  const record = readHint(id, storage);
  return write(id, { ...record, visits: record.visits + 1 }, storage);
}

/** "Show the hints again": forget every slot, including the old one-visit keys. */
export function resetHints(storage: HintStorage | null = browserStorage()): void {
  for (const hint of HINT_REGISTRY) {
    try {
      storage?.removeItem(keyOf(hint.id));
      if (hint.legacyKey === LEGACY_CANVAS_HINT) storage?.removeItem(LEGACY_CANVAS_HINT);
    } catch {
      /* nothing to forget */
    }
  }
  notify();
}

const listeners = new Set<() => void>();

/** The visible plate subscribes, so the third action removes it at once. */
export function subscribeHints(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(): void {
  for (const listener of listeners) listener();
}
