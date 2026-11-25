import { describe, expect, it, vi } from "vitest";
import { BoardDocument, createWidget, type StyleSnapshot } from "@remo/doc";
import { paintOrder, type Widget, type WidgetType } from "@remo/model";
import {
  CHROME_COMMANDS,
  chromeCommandsFor,
  commandById,
  commandForShortcut,
  commandGroup,
  commandsFor,
  isGroupable,
  menuCommands,
  reactionCommands,
  registryCommand,
  selectionHasGroup,
  type ChromeContext,
  type CommandContext,
  type CommandIntent,
} from "./commands";

/**
 * The command list is the single answer to "what can be done with this selection"
 * (ADR-050). These tests pin the answers that used to live in three places — the
 * context menu, the keyboard handler and the right panel.
 */

function boardWith(types: WidgetType[]): BoardDocument {
  const board = new BoardDocument();
  types.forEach((type, index) => {
    const widget: Widget = {
      id: `w${index}`,
      type,
      parentId: null,
      x: index * 220,
      y: 0,
      width: 100,
      height: 100,
      style: { fillColor: "#ffdd33" },
    };
    createWidget(board, widget);
  });
  return board;
}

function contextFor(board: BoardDocument, ids?: string[]): CommandContext {
  const state = { ids: ids ?? [...board.widgets.keys()], style: null as StyleSnapshot | null };
  return {
    board,
    widgets: [...board.widgets.values()],
    ids: state.ids,
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

const key = (k: string, options: { mod?: boolean; shift?: boolean } = {}) => ({
  key: k,
  metaKey: Boolean(options.mod),
  ctrlKey: false,
  shiftKey: Boolean(options.shift),
});

describe("the command list", () => {
  it("offers the object actions in registry order", () => {
    const board = boardWith(["sticky_note", "sticky_note"]);
    const ids = commandsFor("menu", contextFor(board)).map((command) => command.id);
    expect(ids).toEqual([
      "colour",
      "copy",
      "paste",
      "cut",
      "duplicate",
      "copyLink",
      "copyStyle",
      "pasteStyle",
      "clearContent",
      "rotate90",
      "resetRotation",
      "info",
      "front",
      "forward",
      "backward",
      "back",
      "lock",
      "unlockAll",
      "tidy",
      "group",
      "ungroup",
      "delete",
    ]);
  });

  it("keeps the panel to the actions a panel can show", () => {
    const board = boardWith(["sticky_note"]);
    const ids = commandsFor("panel", contextFor(board)).map((command) => command.id);
    expect(ids).not.toContain("pasteStyle");
    expect(ids).toContain("copy");
    expect(ids).toContain("lock");
  });

  it("enables group for two roots and disables it for one", () => {
    const two = boardWith(["sticky_note", "sticky_note"]);
    const one = boardWith(["sticky_note"]);
    expect(isGroupable(contextFor(two))).toBe(true);
    expect(isGroupable(contextFor(one))).toBe(false);
    // A card is not groupable, so two cards are not a group either.
    const cards = boardWith(["card", "card"]);
    expect(isGroupable(contextFor(cards))).toBe(false);
  });

  it("turns Lock into Unlock for a locked selection", () => {
    const board = boardWith(["sticky_note"]);
    const ctx = contextFor(board);
    const lock = commandById("lock")!;
    expect(lock.label(ctx)).toBe("menu.lock");

    lock.run!(ctx);
    expect(board.widgets.get("w0")!.locked).toBe(true);

    const after = contextFor(board);
    expect(lock.label(after)).toBe("menu.unlock");
    lock.run!(after);
    expect(board.widgets.get("w0")!.locked).toBeUndefined();
  });

  it("records the author and refuses another editor's unlock", () => {
    const board = boardWith(["sticky_note"]);
    const lock = commandById("lock")!;
    lock.run!(contextFor(board));
    expect(board.widgets.get("w0")!.lockedBy).toBe("user-a");
    expect(board.widgets.get("w0")!.lockedByName).toBe("Ann");

    const refused = vi.fn();
    const other = { ...contextFor(board), actor: { id: "user-b", name: "Bob" }, refuseUnlock: refused };
    lock.run!(other);
    expect(refused).toHaveBeenCalledWith("Ann");
    expect(board.widgets.get("w0")!.locked).toBe(true);

    // The author may unlock it; the author fields go with the lock.
    lock.run!(contextFor(board));
    expect(board.widgets.get("w0")!.locked).toBeUndefined();
    expect(board.widgets.get("w0")!.lockedBy).toBeUndefined();
  });

  it("lets a board manager release somebody else's lock", () => {
    const board = boardWith(["sticky_note"]);
    const lock = commandById("lock")!;
    lock.run!(contextFor(board));

    const manager = { ...contextFor(board), actor: { id: "user-b", name: "Bob" }, canManage: true };
    lock.run!(manager);
    expect(board.widgets.get("w0")!.locked).toBeUndefined();
  });

  it("unlocks every lock the caller may release", () => {
    const board = boardWith(["sticky_note", "sticky_note"]);
    const lock = commandById("lock")!;
    lock.run!(contextFor(board, ["w0"]));
    lock.run!({ ...contextFor(board, ["w1"]), actor: { id: "user-b", name: "Bob" } });

    const before = contextFor(board);
    const unlockAll = commandById("unlockAll")!;
    expect(unlockAll.enabled(before)).toBe(true);
    unlockAll.run!(before);
    // Only Ann's lock is gone; Bob's still belongs to Bob.
    expect(board.widgets.get("w0")!.locked).toBeUndefined();
    expect(board.widgets.get("w1")!.lockedBy).toBe("user-b");
  });

  it("deletes the selection and clears it", () => {
    const board = boardWith(["sticky_note", "text"]);
    const ctx = contextFor(board);
    const cleared = vi.fn();
    commandById("delete")!.run!({ ...ctx, select: cleared });
    expect(board.widgets.size).toBe(0);
    expect(cleared).toHaveBeenCalledWith([]);
  });

  it("moves a selection one layer and stops at the end", () => {
    const board = boardWith(["shape", "sticky_note"]);
    const ctx = contextFor(board, ["w0"]);
    const order = () => paintOrder([...board.widgets.values()]).map((widget) => widget.id);

    expect(order()).toEqual(["w0", "w1"]);
    commandById("forward")!.run!(ctx);
    expect(order()).toEqual(["w1", "w0"]);

    // Already on top: another step changes nothing.
    commandById("forward")!.run!(contextFor(board, ["w0"]));
    expect(order()).toEqual(["w1", "w0"]);
  });

  it("copies a look and pastes it, but not onto a locked object", () => {
    const board = boardWith(["sticky_note", "sticky_note"]);
    // One clipboard for the whole scenario, like the app's ref.
    const style: { current: StyleSnapshot | null } = { current: null };
    const ctx = (ids: string[]): CommandContext => ({
      ...contextFor(board, ids),
      styleClipboard: {
        get: () => style.current,
        set: (snapshot) => {
          style.current = snapshot;
        },
      },
    });

    board.widgets.set("w0", {
      ...board.widgets.get("w0")!,
      style: { fillColor: "#1a1a1a" },
    });
    commandById("copyStyle")!.run!(ctx(["w0"]));
    expect(commandById("pasteStyle")!.enabled(ctx(["w1"]))).toBe(true);

    // A locked target keeps its own fill.
    commandById("lock")!.run!(ctx(["w1"]));
    commandById("pasteStyle")!.run!(ctx(["w1"]));
    expect(board.widgets.get("w1")!.style?.fillColor).toBe("#ffdd33");

    commandById("lock")!.run!(ctx(["w1"]));
    commandById("pasteStyle")!.run!(ctx(["w1"]));
    expect(board.widgets.get("w1")!.style?.fillColor).toBe("#1a1a1a");
  });
});

describe("shortcuts", () => {
  it("maps the platform keys to the same commands the menu shows", () => {
    const board = boardWith(["sticky_note", "sticky_note"]);
    const ctx = contextFor(board);
    expect(commandForShortcut(key("c", { mod: true }), ctx)?.id).toBe("copy");
    expect(commandForShortcut(key("x", { mod: true }), ctx)?.id).toBe("cut");
    expect(commandForShortcut(key("d", { mod: true }), ctx)?.id).toBe("duplicate");
    expect(commandForShortcut(key("]", { mod: true }), ctx)?.id).toBe("forward");
    expect(commandForShortcut(key("]", { mod: true, shift: true }), ctx)?.id).toBe("front");
    expect(commandForShortcut(key("[", { mod: true }), ctx)?.id).toBe("backward");
    expect(commandForShortcut(key("[", { mod: true, shift: true }), ctx)?.id).toBe("back");
    expect(commandForShortcut(key("l", { mod: true, shift: true }), ctx)?.id).toBe("lock");
    expect(commandForShortcut(key("g", { mod: true }), ctx)?.id).toBe("group");
    expect(commandForShortcut(key("g", { mod: true, shift: true }), ctx)?.id).toBe("ungroup");
    expect(commandForShortcut(key("Delete"), ctx)?.id).toBe("delete");
    expect(commandForShortcut(key("Backspace"), ctx)?.id).toBe("delete");
  });

  it("leaves a key to the browser when the command has nothing to do", () => {
    const board = boardWith(["sticky_note"]);
    const empty = contextFor(board, []);
    // Copy with nothing selected must fall through to the browser's own copy.
    expect(commandForShortcut(key("c", { mod: true }), empty)).toBeNull();
    expect(commandForShortcut(key("Delete"), empty)).toBeNull();
    // Grouping claims the key even when it would do nothing, so the browser's
    // "find next" never opens by accident.
    expect(commandForShortcut(key("g", { mod: true }), contextFor(board))?.id).toBe("group");
  });
});

/**
 * The chrome half of the registry (ADR-266 §1.1, T5 acceptance).
 *
 * Every row of every header menu has to be a command here: that is what keeps the
 * menu and the future ⌘K search from drifting. The checks run over the registry, not
 * over a component, so adding a menu row by hand fails before a browser opens.
 */
describe("the chrome registry", () => {
  const allOn: ChromeContext = {
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
    },
    run: vi.fn(),
  };

  it("has one id per command, a title and RU/EN synonyms", () => {
    const ids = CHROME_COMMANDS.map((command) => command.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const command of CHROME_COMMANDS) {
      expect(command.title, command.id).toBeTruthy();
      expect(command.synonyms.ru.length, `${command.id} ru`).toBeGreaterThan(0);
      expect(command.synonyms.en.length, `${command.id} en`).toBeGreaterThan(0);
      expect(command.surfaces, command.id).toContain("header");
      expect(command.surfaces, command.id).toContain("palette");
    }
  });

  it("builds each intent menu from registry entries only", () => {
    const intents: CommandIntent[] = ["room", "run", "agent", "account", "help"];
    for (const intent of intents) {
      const menu = menuCommands([intent], allOn);
      expect(menu.length, intent).toBeGreaterThan(0);
      for (const command of menu) {
        expect(registryCommand(command.id), `${intent}: ${command.id}`).toBe(command);
        expect(command.intent, command.id).toBe(intent);
      }
    }
  });

  it("keeps a menu group at seven rows and puts danger last", () => {
    const menu = menuCommands(["room"], allOn);
    const groups = new Map<string, number>();
    for (const command of menu) {
      const group = commandGroup(command);
      groups.set(group, (groups.get(group) ?? 0) + 1);
    }
    for (const [group, count] of groups) expect(count, group).toBeLessThanOrEqual(7);
    expect(commandGroup(menu[menu.length - 1]!)).toBe("danger");
    expect(menu[menu.length - 1]!.danger).toBe(true);
  });

  it("offers every chrome command the account menu needs, and the reactions", () => {
    const account = menuCommands(["account", "help"], allOn);
    const ids = account.map((command) => command.id);
    for (const id of [
      "account.allRooms",
      "account.theme.light",
      "account.theme.dark",
      "account.lang.ru",
      "account.lang.en",
      "account.help",
      "account.delete",
      "account.signOut",
    ]) {
      expect(ids, id).toContain(id);
    }
    expect(reactionCommands().map((command) => command.id)).toContain("run.reaction.clap");
    expect(chromeCommandsFor("account").every((command) => command.surfaces.includes("header"))).toBe(
      true,
    );
  });

  it("hides an unavailable row only when the command asks for it", () => {
    const nothing: ChromeContext = { can: {}, run: vi.fn() };
    const account = menuCommands(["account"], nothing);
    expect(account.map((command) => command.id)).not.toContain("account.sessions");
    // A row that stays is disabled and says why.
    const room = menuCommands(["room"], nothing);
    const trash = room.find((command) => command.id === "room.trash");
    expect(trash).toBeUndefined();
    const app = room.find((command) => command.id === "room.apps");
    expect(app).toBeUndefined();
  });

  it("offers the guide's row only when the installation has a guide (ADR-284)", () => {
    const ids = (can: ChromeContext["can"]) =>
      menuCommands(["account"], { can, run: vi.fn() }).map((command) => command.id);
    expect(ids({ docs: true })).toContain("account.docs");
    // `docs.origin: null` is a self-host without documentation: no row, not a dead one.
    expect(ids({})).not.toContain("account.docs");
  });
});

describe("grouping", () => {
  it("selects every member after the group is made", () => {
    const board = boardWith(["sticky_note", "sticky_note"]);
    const ctx = contextFor(board);
    const selected = vi.fn();
    commandById("group")!.run!({ ...ctx, select: selected });

    const groupId = board.widgets.get("w0")!.groupId;
    expect(groupId).toBeTruthy();
    expect(selected).toHaveBeenCalledWith(["w0", "w1"]);
    expect(selectionHasGroup(contextFor(board))).toBe(true);
  });
});
