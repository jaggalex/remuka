import { describe, expect, it, vi } from "vitest";
import { BoardDocument, createWidget, type StyleSnapshot } from "@remo/doc";
import type { Widget } from "@remo/model";
import {
  buildSearchRows,
  matchRank,
  rankSearchRows,
  readRecentCommands,
  recentRows,
  rememberCommand,
  suggestionRows,
  RECENT_LIMIT,
  RECENT_STORAGE_KEY,
  RANK_SYNONYM,
  RANK_TITLE,
  RANK_WORD,
  type CommandStorage,
  type SearchRow,
} from "./commandSearch";
import {
  CHROME_COMMANDS,
  COMMANDS,
  type ChromeContext,
  type CommandContext,
} from "./commands";

/**
 * The command search (ADR-266 §1.2, T7).
 *
 * The acceptance walks the registry itself: every command — object or chrome — owes the
 * search words in both languages, and the ranking has to put a title match above a
 * word match above a synonym. Neither check reads the dialog; both read the data.
 */

function boardWith(): BoardDocument {
  const board = new BoardDocument();
  const widget: Widget = {
    id: "w0",
    type: "sticky_note",
    parentId: null,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    style: { fillColor: "#f4e0a8" },
  };
  createWidget(board, widget);
  return board;
}

function objectContext(ids: string[] = []): CommandContext {
  const board = boardWith();
  const state = { style: null as StyleSnapshot | null };
  return {
    board,
    widgets: [...board.widgets.values()],
    ids,
    copy: vi.fn(),
    cut: vi.fn(),
    paste: vi.fn(),
    duplicate: vi.fn(),
    select: vi.fn(),
    info: vi.fn(),
    styleClipboard: {
      get: () => state.style,
      set: (snapshot) => {
        state.style = snapshot;
      },
    },
    actor: { id: "user-a", name: "Ann" },
    canManage: false,
    refuseUnlock: vi.fn(),
  };
}

const allAllowed: ChromeContext = {
  can: {
    rename: true,
    export: true,
    import: true,
    duplicate: true,
    delete: true,
    access: true,
    facilitate: true,
    agents: true,
    askAgents: true,
    apps: true,
    signedIn: true,
    support: true,
    templates: true,
    docs: true,
    search: true,
  },
  run: vi.fn(),
};

function memoryStorage(seed: string[] = []): CommandStorage & { value: () => string[] } {
  let value = seed.length ? JSON.stringify(seed) : null;
  return {
    getItem: (key) => (key === RECENT_STORAGE_KEY ? value : null),
    setItem: (key, next) => {
      if (key === RECENT_STORAGE_KEY) value = next;
    },
    value: () => (value ? (JSON.parse(value) as string[]) : []),
  };
}

describe("the search walks the whole registry", () => {
  it("gives every command RU and EN synonyms, and one id each", () => {
    const ids = [...COMMANDS, ...CHROME_COMMANDS].map((command) => command.id);
    expect(new Set(ids).size, "duplicate id across the two halves").toBe(ids.length);
    for (const command of COMMANDS) {
      expect(command.synonyms.ru.length, `${command.id} ru`).toBeGreaterThan(0);
      expect(command.synonyms.en.length, `${command.id} en`).toBeGreaterThan(0);
    }
    for (const command of CHROME_COMMANDS) {
      expect(command.synonyms.ru.length, `${command.id} ru`).toBeGreaterThan(0);
      expect(command.synonyms.en.length, `${command.id} en`).toBeGreaterThan(0);
    }
  });

  it("builds rows from the palette surface only, with a reason for a refused row", () => {
    const rows = buildSearchRows(objectContext(), allAllowed);
    const ids = rows.map((row) => row.id);
    expect(ids).toContain("room.export");
    expect(ids).toContain("run.timer");
    expect(ids).not.toContain("colour"); // a grid, it has nothing to run
    expect(ids).not.toContain("search.open"); // the row that opens the search

    // No selection: "Delete" is still listed, greyed, and says why.
    const remove = rows.find((row) => row.id === "delete")!;
    expect(remove.reason).toBe("search.needSelection");
    expect(rows.find((row) => row.id === "paste")!.reason).toBeUndefined();
  });

  it("leaves out a command whose whole feature is absent here", () => {
    const rows = buildSearchRows(objectContext(), { can: {}, run: vi.fn() });
    const ids = rows.map((row) => row.id);
    expect(ids).not.toContain("agent.open");
    expect(ids).not.toContain("account.sessions");
    // A room-only row is greyed with a reason, not hidden, when the role refuses it.
    expect(rows.find((row) => row.id === "room.rename")!.reason).toBe("iam.readOnly");
  });
});

describe("ranking", () => {
  const synonyms = { ru: ["выгрузить", "скачать"], en: ["download"] };

  it("puts the start of the title above the start of a word above a synonym", () => {
    expect(matchRank("эксп", "Экспорт в PNG", synonyms)).toBe(RANK_TITLE);
    expect(matchRank("эксп", "Наш экспорт", synonyms)).toBe(RANK_WORD);
    expect(matchRank("выгруз", "Экспорт в PNG", synonyms)).toBe(RANK_SYNONYM);
    expect(matchRank("download", "Экспорт в PNG", synonyms)).toBe(RANK_SYNONYM);
    expect(matchRank("совсем другое", "Экспорт в PNG", synonyms)).toBeNull();
  });

  it("ignores case and ё, and matches a multi-word query word by word", () => {
    expect(matchRank("ТЕМНАЯ", "Тёмная тема", synonyms)).toBe(RANK_TITLE);
    expect(matchRank("тёмная тема", "Тёмная тема", synonyms)).toBe(RANK_TITLE);
    expect(matchRank("скачать pdf", "Экспорт в PDF", { ...synonyms, ru: ["скачать"], en: [] })).toBe(
      RANK_SYNONYM,
    );
  });

  it("keeps registry order inside one rank", () => {
    const rows = [
      { id: "a", title: "Найти действие", synonyms: { ru: [], en: [] } },
      { id: "b", title: "Найти команду", synonyms: { ru: [], en: [] } },
      { id: "c", title: "Поиск", synonyms: { ru: ["найти"], en: [] } },
    ];
    const ranked = rankSearchRows("найти", rows, (row) => row);
    expect(ranked.map((row) => row.id)).toEqual(["a", "b", "c"]);
  });
});

describe("recent commands", () => {
  it("keeps ten ids, newest first, without duplicates", () => {
    const storage = memoryStorage();
    for (let index = 0; index < 12; index += 1) rememberCommand(`command.${index}`, storage);
    rememberCommand("command.5", storage);
    const ids = readRecentCommands(storage);
    expect(ids).toHaveLength(RECENT_LIMIT);
    expect(ids[0]).toBe("command.5");
    expect(new Set(ids).size).toBe(RECENT_LIMIT);
  });

  it("survives a broken or missing storage", () => {
    expect(readRecentCommands(null)).toEqual([]);
    const broken: CommandStorage = {
      getItem: () => "not json",
      setItem: () => undefined,
    };
    expect(readRecentCommands(broken)).toEqual([]);
  });

  it("turns ids into rows and skips what the registry no longer has", () => {
    const rows: SearchRow[] = [
      {
        id: "run.timer",
        title: "facilitation.timer.button",
        where: "facilitation.menu",
        synonyms: { ru: [], en: [] },
        scope: "chrome",
        intent: "run",
        run: vi.fn(),
      },
    ];
    expect(recentRows(rows, ["gone", "run.timer"]).map((row) => row.id)).toEqual(["run.timer"]);
  });
});

describe("context suggestions", () => {
  it("offers the session commands with no selection and the selection's own with one", () => {
    const rows = buildSearchRows(objectContext(), allAllowed);
    const idle = suggestionRows(rows, { hasSelection: false }).map((row) => row.id);
    expect(idle).toEqual(["run.timer", "run.vote", "run.presentation"]);

    const withSelection = buildSearchRows(objectContext(["w0"]), allAllowed);
    const selected = suggestionRows(withSelection, { hasSelection: true }).map((row) => row.id);
    expect(selected).toEqual(["copy", "paste", "cut"]);
  });

  it("does not repeat a recent command and never suggests a refused one", () => {
    const rows = buildSearchRows(objectContext(), allAllowed);
    const again = suggestionRows(rows, { hasSelection: false, exclude: ["run.timer"] }).map(
      (row) => row.id,
    );
    expect(again).not.toContain("run.timer");
    expect(again).toHaveLength(3);

    const readOnly = buildSearchRows(objectContext(), { can: {}, run: vi.fn() });
    const suggestions = suggestionRows(readOnly, { hasSelection: false });
    expect(suggestions.every((row) => !row.reason)).toBe(true);
  });
});
