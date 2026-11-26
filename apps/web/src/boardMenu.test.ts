import { describe, expect, it, vi } from "vitest";
import { BoardDocument, createWidget, type StyleSnapshot } from "@remo/doc";
import type { KanbanState, Widget, WidgetType } from "@remo/model";
import { buildBoardMenu } from "./boardMenu";
import { COMMAND_GROUPS, COMMANDS, registryCommand, type CommandContext } from "./commands";
import type { MenuItem } from "./ContextMenu";

/**
 * The canvas menu's order is the registry's (ADR-267 §3, task T6).
 *
 * These checks walk every kind of target a right-click can land on, because the order
 * used to be a hand-kept list in `boardMenu.ts` and drift showed up first on the one
 * target nobody re-checked. "Delete last" is asserted per target for the same reason.
 */

function widget(id: string, type: WidgetType, overrides: Partial<Widget> = {}): Widget {
  return {
    id,
    type,
    parentId: null,
    x: 0,
    y: 0,
    width: 120,
    height: 100,
    style: { fillColor: "#f4e0a8" },
    ...overrides,
  };
}

const kanbanState: KanbanState = {
  columns: [
    { id: "col0", title: "Todo", accent: "#9ca3af", width: 400 },
    { id: "col1", title: "Doing", accent: "#f2b94a", width: 400 },
  ],
  swimlanes: [{ id: "lane0", title: "Lane" }],
  cards: { card1: { columnId: "col1", swimlaneId: "lane0", order: "n" } },
  newColumnWidth: 400,
  headerHeight: 48,
};

function boardWith(widgets: Widget[]): BoardDocument {
  const board = new BoardDocument();
  for (const value of widgets) createWidget(board, value);
  return board;
}

function contextFor(board: BoardDocument, ids: string[]): CommandContext {
  const state = { ids, style: null as StyleSnapshot | null };
  return {
    board,
    widgets: [...board.widgets.values()],
    ids,
    copy: vi.fn(),
    cut: vi.fn(),
    paste: vi.fn(),
    duplicate: vi.fn(),
    select: (next) => {
      state.ids = next;
    },
    info: vi.fn(),
    styleClipboard: {
      get: () => state.style,
      set: (snapshot) => {
        state.style = snapshot;
      },
    },
    actor: { id: "user-a", name: "Ann" },
    canManage: false,
    refuseUnlock: () => undefined,
  };
}

const t = (key: string) => key;

function menuFor(
  target: Parameters<typeof buildBoardMenu>[0]["target"],
  board: BoardDocument,
  options: { ids?: string[]; writeBlocked?: boolean } = {},
) {
  return buildBoardMenu({
    target,
    point: { x: 10, y: 10, world: { x: 10, y: 10 } },
    board,
    kanbanStates: { kanban1: kanbanState },
    commandContext: contextFor(board, options.ids ?? []),
    writeBlocked: options.writeBlocked ?? false,
    copyIds: async () => true,
    duplicateIds: () => undefined,
    pasteSelection: async () => undefined,
    count: (_key, n) => `${n} objects`,
    t,
  }).menu!;
}

/** Bodies of the groups as command ids, so the shape of the menu is readable. */
const idsOf = (groups: MenuItem[][]) => groups.map((group) => group.map((item) => item.commandId));

describe("the canvas menu", () => {
  it("names what was right-clicked", () => {
    const board = boardWith([widget("n1", "sticky_note")]);
    expect(menuFor({ kind: "selection", ids: ["n1"] }, board).title).toBe("tool.sticky");

    const shape = boardWith([widget("s1", "shape")]);
    expect(menuFor({ kind: "selection", ids: ["s1"] }, shape).title).toBe("tool.shape");

    const table = boardWith([
      widget("f1", "frame", {
        layout: {
          kind: "table",
          columns: [{ id: "c1", title: "Now" }],
          rows: [{ id: "r1", title: "Step" }],
          active: true,
        },
      }),
    ]);
    expect(menuFor({ kind: "selection", ids: ["f1"] }, table).title).toBe("section.view.table");

    const two = boardWith([widget("n1", "sticky_note"), widget("n2", "sticky_note")]);
    expect(menuFor({ kind: "selection", ids: ["n1", "n2"] }, two).title).toBe("2 objects");

    const empty = boardWith([]);
    expect(menuFor({ kind: "selection", ids: [] }, empty).title).toBe("menu.canvas");
  });

  it("groups rows main → clipboard → arrange → danger for every object", () => {
    const cases: Array<[string, Widget[]]> = [
      ["a note", [widget("n1", "sticky_note")]],
      ["a shape", [widget("s1", "shape")]],
      ["free text", [widget("t1", "text")]],
      ["a picture", [widget("i1", "image")]],
      ["a frame", [widget("f1", "frame")]],
      ["a line", [widget("c1", "connector", { start: { item: "n1" }, end: { item: "n2" } })]],
      [
        "two notes",
        [widget("n1", "sticky_note"), widget("n2", "sticky_note")],
      ],
    ];
    for (const [name, widgets] of cases) {
      const board = boardWith(widgets);
      const ids = widgets.map((entry) => entry.id);
      const menu = menuFor({ kind: "selection", ids }, board, { ids });
      expect(menu.groups.every((group) => group.length <= 7), name).toBe(true);
      // The search row is its own last group before the danger group (T7); it is not a
      // canvas command, so the group-order check reads the registry groups only.
      const groups = menu.groups.filter(
        (group) => !group.some((row) => row.commandId === "search.open"),
      );
      const order = groups.map((group) => {
        const first = group.find((row) => row.commandId);
        const command = COMMANDS.find((entry) => entry.id === first?.commandId);
        expect(command, first?.label).toBeTruthy();
        return COMMAND_GROUPS.indexOf(command!.group);
      });
      const sorted = [...order].sort((a, b) => a - b);
      expect(order, name).toEqual(sorted);
      const last = groups[groups.length - 1]!;
      expect(last[last.length - 1]!.commandId, name).toBe("delete");
      expect(last[last.length - 1]!.danger, name).toBe(true);
      expect(last[last.length - 1]!.label, name).toBe("menu.delete");
    }
  });

  it("opens the sticky note menu with text editing and colour", () => {
    const board = boardWith([widget("n1", "sticky_note")]);
    const menu = menuFor({ kind: "selection", ids: ["n1"] }, board);
    expect(idsOf(menu.groups)[0]?.slice(0, 2)).toEqual(["editText", "colour"]);
    expect(menu.groups[0]?.[0]?.label).toBe("menu.editText");
    expect(idsOf(menu.groups).flat()).toContain("tidy");
  });

  it("keeps Delete last on the kanban's own menus", () => {
    const board = boardWith([widget("kanban1", "kanban"), widget("card1", "card")]);
    const targets = [
      ["column", { kind: "column", kanbanId: "kanban1", columnId: "col0", index: 0 }],
      ["swimlane", { kind: "swimlane", kanbanId: "kanban1", swimlaneId: "lane0", index: 0 }],
      ["card", { kind: "card", kanbanId: "kanban1", cardId: "card1" }],
    ] as const;
    const labels: Record<string, string> = {
      column: "menu.deleteColumn",
      swimlane: "menu.deleteSwimlane",
      card: "menu.deleteCard",
    };
    for (const [name, target] of targets) {
      const menu = menuFor(target, board);
      for (const row of menu.groups.flat()) expect(registryCommand(row.commandId!), row.label).toBeDefined();
      for (const row of menuFor(target, board, {writeBlocked: true}).groups.flat()) {
        expect(Boolean(row.disabled), row.commandId).toBe(row.commandId !== "kanban.card.copy");
      }
      const last = menu.groups[menu.groups.length - 1]!;
      expect(last[last.length - 1]!.label, name).toBe(labels[name]);
      expect(last[last.length - 1]!.danger, name).toBe(true);
    }
  });

  it("offers the palette grid on a note, a shape and a line", () => {
    const board = boardWith([
      widget("n1", "sticky_note", { style: { fillColor: "#f4e0a8" } }),
      widget("s1", "shape", { style: { fillColor: "#cddff8" } }),
      widget("c1", "connector", { style: { strokeColor: "#1a6ad8" } }),
    ]);
    const gridFor = (id: string) =>
      idsOf(menuFor({ kind: "selection", ids: [id] }, board, { ids: [id] }).groups)
        .flat()
        .includes("colour")
        ? menuFor({ kind: "selection", ids: [id] }, board, { ids: [id] })
            .groups.flat()
            .find((item) => item.commandId === "colour")!.grid
        : null;

    // A fill offers the 100 and 300 rows in the window's order — 7 × 2.
    const note = gridFor("n1");
    expect(note?.choices).toHaveLength(14);
    expect(note?.choices[0]?.value).toBe("#f3f1ec");
    expect(note?.current).toBe("#f4e0a8");
    expect(gridFor("s1")?.current).toBe("#cddff8");
    // A line has one row: 600.
    const line = gridFor("c1");
    expect(line?.choices).toHaveLength(7);
    expect(line?.choices[0]?.value).toBe("#58534e");
  });

  it("writes the chosen colour through the document command", () => {
    const board = boardWith([widget("n1", "sticky_note", { style: { fillColor: "#f4e0a8" } })]);
    const menu = menuFor({ kind: "selection", ids: ["n1"] }, board, { ids: ["n1"] });
    const grid = menu.groups.flat().find((item) => item.commandId === "colour")!.grid!;
    grid.pick("#f9d3cd");
    expect(board.readWidget("n1")!.style?.fillColor).toBe("#f9d3cd");
    // Locked objects keep their sheet: the grid is not offered at all.
    board.widgets.set("n1", { ...board.readWidget("n1")!, locked: true });
    const locked = menuFor({ kind: "selection", ids: ["n1"] }, board, { ids: ["n1"] });
    expect(locked.groups.flat().some((item) => item.commandId === "colour")).toBe(false);
  });

  it("keeps only the readable rows in a read-only room", () => {
    const board = boardWith([widget("n1", "sticky_note")]);
    const menu = menuFor({ kind: "selection", ids: ["n1"] }, board, {
      ids: ["n1"],
      writeBlocked: true,
    });
    const ids = idsOf(menu.groups).flat();
    expect(ids).toContain("copy");
    expect(ids).toContain("info");
    expect(ids).not.toContain("colour");
    expect(ids).not.toContain("delete");
  });

  it("puts the search row last, before the danger group (T7)", () => {
    const board = boardWith([widget("n1", "sticky_note")]);
    const groups = menuFor({ kind: "selection", ids: ["n1"] }, board, { ids: ["n1"] }).groups;
    const ids = idsOf(groups).flat();
    expect(ids).toContain("search.open");

    const searchGroup = groups.findIndex((group) =>
      group.some((row) => row.commandId === "search.open"),
    );
    // Its own group, immediately before the one that holds Delete.
    expect(searchGroup).toBe(groups.length - 2);
    expect(idsOf(groups)[groups.length - 1]).toContain("delete");
    const row = groups[searchGroup]![0]!;
    expect(row.label).toBe("search.action");
    expect(row.shortcut).toBe("⌘K");

    // The empty canvas offers it too: the spec gives the row to the canvas, not only
    // to a selection.
    const canvas = menuFor({ kind: "selection", ids: [] }, boardWith([])).groups;
    expect(idsOf(canvas).flat()).toContain("search.open");
  });
});
