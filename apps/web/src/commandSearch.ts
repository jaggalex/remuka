import type {
  ChromeCommand,
  ChromeContext,
  Command,
  CommandContext,
  CommandIntent,
  CommandSynonyms,
} from "./commands";
import { CHROME_COMMANDS, COMMANDS, runCommand, shortcutLabel } from "./commands";
import type { TranslationKey } from "./i18n";

/**
 * The command search's own logic: what the list holds, in what order, and what it
 * remembers between visits (ADR-266 §1.2, T7).
 *
 * The rows are the registry — the same descriptors the menus render — so a command
 * cannot be in one place and missing from the other. This module knows nothing about
 * React or the DOM: the ranking, the recent list and the suggestions are pure, and the
 * dialog only renders what they return.
 */
export interface SearchRow {
  id: string;
  /** The title key, resolved by the dialog in the reader's language. */
  title: TranslationKey;
  /** The menu the command lives in, shown under the title ("Run", "Room menu"). */
  where: TranslationKey;
  synonyms: CommandSynonyms;
  /** Display-ready keys, e.g. "⌘K" or "⇧E". */
  shortcut?: string;
  danger?: boolean;
  /** Why the command cannot run now; absent when it can. */
  reason?: TranslationKey;
  /** Which half of the registry it came from: the selection suggestions read this. */
  scope: "object" | "chrome";
  intent: CommandIntent;
  run: () => void;
}

/** Where a row's owner menu is, by intent. */
const INTENT_WHERE: Record<CommandIntent, TranslationKey> = {
  invite: "board.share",
  run: "facilitation.menu",
  agent: "roomAgent.menu",
  room: "board.menu",
  account: "account.menu",
  canvas: "menu.canvas",
  help: "help.title",
};

/** The row that opens this dialog is not itself a result of it. */
const SELF = "search.open";

/**
 * The rows the search can offer, built from both halves of the registry.
 *
 * A command that a menu hides because the whole feature is absent here (no agents, no
 * guide, a guest) is absent from the search too: a greyed row with nothing the person
 * can do would be noise. A command that exists but is refused right now — a read-only
 * role, a plan — stays and says why, in words.
 */
export function buildSearchRows(object: CommandContext, chrome: ChromeContext): SearchRow[] {
  const objectRows = COMMANDS.filter(
    (command) => command.surfaces.includes("palette") && command.run,
  ).map((command) => objectRow(command, object));
  const chromeRows = CHROME_COMMANDS.filter(
    (command) =>
      command.surfaces.includes("palette") &&
      command.id !== SELF &&
      !(command.hideWhenUnavailable && command.available(chrome) !== true),
  ).map((command) => chromeRow(command, chrome));
  return [...objectRows, ...chromeRows];
}

function objectRow(command: Command, ctx: CommandContext): SearchRow {
  const enabled = command.enabled(ctx);
  return {
    id: command.id,
    title: command.label(ctx) as TranslationKey,
    where: INTENT_WHERE.canvas,
    synonyms: command.synonyms,
    shortcut: command.shortcut ? shortcutLabel(command.shortcut) : undefined,
    danger: command.danger,
    reason: enabled ? undefined : (command.unavailable ?? "search.needSelection"),
    scope: "object",
    intent: "canvas",
    run: () => runCommand(command, ctx),
  };
}

function chromeRow(command: ChromeCommand, ctx: ChromeContext): SearchRow {
  const available = command.available(ctx);
  return {
    id: command.id,
    title: command.title,
    where: INTENT_WHERE[command.intent],
    synonyms: command.synonyms,
    shortcut: command.shortcut,
    danger: command.danger,
    reason: available === true ? undefined : available.reason,
    scope: "chrome",
    intent: command.intent,
    run: () => command.run(ctx),
  };
}

/* --------------------------------------------------------------- ranking --- */

/** Lower is better; a row that does not match is left out. */
export const RANK_TITLE = 0;
export const RANK_WORD = 1;
export const RANK_SYNONYM = 2;

/** Case-, ё- and spacing-insensitive, so "Тёмная" and "темная" are one word. */
function normalise(value: string): string {
  return value.toLocaleLowerCase("ru").replace(/ё/g, "е").trim().replace(/\s+/g, " ");
}

/** Words of a phrase, punctuation dropped: "Export…" → "export". */
function words(value: string): string[] {
  return normalise(value).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

function synonymWords(synonyms: CommandSynonyms): string[] {
  return [...synonyms.ru, ...synonyms.en].map(normalise);
}

/**
 * How a row matches the query (ADR-266 §1.2):
 * the title starts with it → the start of a title word → inside a synonym.
 *
 * A multi-word query is matched word by word ("скачать pdf"), and the worst of its
 * words decides the rank, so a phrase never outranks a plain title match.
 */
export function matchRank(
  query: string,
  title: string,
  synonyms: CommandSynonyms,
): number | null {
  const needle = normalise(query);
  if (!needle) return null;
  const normalTitle = normalise(title);
  const titleWords = words(title);
  const syn = synonymWords(synonyms);
  const synWords = syn.flatMap(words);

  const one = (token: string): number | null => {
    if (normalTitle.startsWith(token)) return RANK_TITLE;
    if (titleWords.some((word) => word.startsWith(token))) return RANK_WORD;
    if (syn.some((word) => word.startsWith(token)) || synWords.some((word) => word.startsWith(token))) {
      return RANK_SYNONYM;
    }
    return null;
  };

  const whole = one(needle);
  if (whole !== null) return whole;

  const tokens = words(query);
  if (tokens.length < 2) return null;
  let worst = RANK_TITLE;
  for (const token of tokens) {
    const rank = one(token);
    if (rank === null) return null;
    worst = Math.max(worst, rank);
  }
  return worst;
}

/**
 * Matching rows in rank order; equal ranks keep registry order, so the list is stable
 * between keystrokes and a command never jumps over its neighbour for no reason.
 */
export function rankSearchRows<T>(
  query: string,
  rows: readonly T[],
  textOf: (row: T) => { title: string; synonyms: CommandSynonyms },
): T[] {
  const ranked: Array<{ row: T; rank: number; index: number }> = [];
  rows.forEach((row, index) => {
    const text = textOf(row);
    const rank = matchRank(query, text.title, text.synonyms);
    if (rank !== null) ranked.push({ row, rank, index });
  });
  ranked.sort((a, b) => a.rank - b.rank || a.index - b.index);
  return ranked.map((entry) => entry.row);
}

/* ---------------------------------------------------------------- recent --- */

/** Browser settings, not board state (ADR-123); the key keeps the code name (ADR-254). */
export const RECENT_STORAGE_KEY = "remo.commands.recent";
export const RECENT_LIMIT = 10;
/** How many of them the empty search shows. */
export const RECENT_SHOWN = 5;
/** How many context suggestions follow them. */
export const SUGGESTION_COUNT = 3;

/** The two methods the recent list needs; a test supplies its own. */
export interface CommandStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

function browserStorage(): CommandStorage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    // Private mode can refuse storage; the search still works, it just forgets.
    return null;
  }
}

/** The last commands run from the search in this browser, newest first. */
export function readRecentCommands(storage: CommandStorage | null = browserStorage()): string[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(RECENT_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((id): id is string => typeof id === "string")
      .slice(0, RECENT_LIMIT);
  } catch {
    return [];
  }
}

/** Put one id in front, drop the duplicate and keep the ten newest. */
export function rememberCommand(
  id: string,
  storage: CommandStorage | null = browserStorage(),
): string[] {
  const next = [id, ...readRecentCommands(storage).filter((entry) => entry !== id)].slice(
    0,
    RECENT_LIMIT,
  );
  try {
    storage?.setItem(RECENT_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // A full or forbidden storage is not a reason to fail the command.
  }
  return next;
}

/** The recent ids as rows, in recency order; ids the registry no longer has are skipped. */
export function recentRows(
  rows: readonly SearchRow[],
  ids: readonly string[],
  limit = RECENT_SHOWN,
): SearchRow[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids
    .map((id) => byId.get(id))
    .filter((row): row is SearchRow => Boolean(row))
    .slice(0, limit);
}

/**
 * Three commands the room suggests before anything is typed (ADR-266 §1.2).
 *
 * With a selection, the actions that act on it; otherwise the three ways to run the
 * session, which is what a room is for. Recent commands are not repeated, and a
 * command that cannot run right now is not offered as a suggestion.
 */
export function suggestionRows(
  rows: readonly SearchRow[],
  options: { hasSelection: boolean; exclude?: readonly string[] },
): SearchRow[] {
  const exclude = new Set(options.exclude ?? []);
  const pool = rows.filter(
    (row) =>
      !row.reason &&
      !exclude.has(row.id) &&
      (options.hasSelection ? row.scope === "object" : row.intent === "run"),
  );
  return pool.slice(0, SUGGESTION_COUNT);
}
