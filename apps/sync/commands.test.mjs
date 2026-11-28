import { describe, expect, it } from "vitest";
import { answersKey, backTextKey } from "@remo/model";
import { linesOf, toMarkdown } from "@remo/text";
import { Y } from "./y.mjs";
import { COMMANDS, CommandError, commandObjectId, docVersion, runCommand } from "./commands.mjs";

const actor = { type: "user", id: "u1", name: "Alex" };

function docWithNote() {
  const ydoc = new Y.Doc();
  const created = runCommand({
    ydoc,
    name: "board.item.create",
    input: { type: "sticky_note", x: 10, y: 20, content: "Hello" },
    actor,
    boardId: "b1",
  });
  return { ydoc, id: created.result.id, version: created.version };
}

describe("command registry (ADR-092)", () => {
  it("creates one object and its text in one transaction", () => {
    const { ydoc, id } = docWithNote();
    const widget = ydoc.getMap("widgets").get(id);
    expect(widget).toMatchObject({
      id,
      type: "sticky_note",
      x: 10,
      y: 20,
      createdBy: "Alex",
    });
    expect(ydoc.getMap("texts").get(id).toString()).toBe("Hello");
  });

  it("refuses to create over an existing object", () => {
    const { ydoc, id } = docWithNote();
    expect(() =>
      runCommand({
        ydoc,
        name: "board.item.create",
        input: { type: "sticky_note", x: 0, y: 0 },
        actor,
        boardId: "b1",
        objectId: id,
      }),
    ).toThrow(expect.objectContaining({ code: "OBJECT_EXISTS", status: 409 }));
    expect(() =>
      runCommand({
        ydoc,
        name: "board.item.create",
        input: { id, type: "sticky_note", x: 0, y: 0 },
        actor,
        boardId: "b1",
      }),
    ).toThrow(expect.objectContaining({ code: "BAD_INPUT" }));
  });

  it("changes a version on every write and refuses a stale caller", () => {
    const { ydoc, id, version } = docWithNote();
    runCommand({
      ydoc,
      name: "board.item.update",
      input: { id, patch: { x: 99 } },
      actor,
      boardId: "b1",
    });
    expect(docVersion(ydoc)).not.toBe(version);
    expect(() =>
      runCommand({
        ydoc,
        name: "board.item.update",
        input: { id, patch: { x: 1 } },
        actor,
        boardId: "b1",
        ifVersion: version,
      }),
    ).toThrow(expect.objectContaining({ code: "STALE", status: 409 }));
  });

  it("updates fields and the materialized text together", () => {
    const { ydoc, id } = docWithNote();
    runCommand({
      ydoc,
      name: "board.item.update",
      input: { id, patch: { content: "Changed", width: 200 } },
      actor,
      boardId: "b1",
    });
    expect(ydoc.getMap("widgets").get(id)).toMatchObject({ content: "Changed", width: 200 });
    expect(ydoc.getMap("texts").get(id).toString()).toBe("Changed");
  });

  it("accepts a rotation on a kind that turns and ignores it elsewhere (ADR-271)", () => {
    const { ydoc, id } = docWithNote();
    runCommand({
      ydoc,
      name: "board.item.update",
      input: { id, patch: { rotation: 270 } },
      actor,
      boardId: "b1",
    });
    expect(ydoc.getMap("widgets").get(id).rotation).toBe(-90);

    // A card is placed by its matrix and never turns: the value is not stored.
    const widgets = ydoc.getMap("widgets");
    const card = { ...widgets.get(id), id: "card_1", type: "card", parentId: "k1" };
    widgets.set("card_1", card);
    runCommand({
      ydoc,
      name: "board.item.update",
      input: { id: "card_1", patch: { rotation: 45 } },
      actor,
      boardId: "b1",
    });
    expect(widgets.get("card_1").rotation).toBeUndefined();

    expect(() =>
      runCommand({
        ydoc,
        name: "board.item.update",
        input: { id, patch: { rotation: "sideways" } },
        actor,
        boardId: "b1",
      }),
    ).toThrow(expect.objectContaining({ code: "BAD_INPUT" }));
  });

  it("names an object without touching its text or geometry", () => {
    const { ydoc, id } = docWithNote();
    runCommand({
      ydoc,
      name: "board.item.update",
      input: { id, patch: { name: "  Intro  " } },
      actor,
      boardId: "b1",
    });
    expect(ydoc.getMap("widgets").get(id)).toMatchObject({ name: "Intro", content: "Hello", x: 10 });
    expect(ydoc.getMap("texts").get(id).toString()).toBe("Hello");

    // A second object may carry the same name: names are labels, not identity.
    const second = runCommand({
      ydoc,
      name: "board.item.create",
      input: { type: "sticky_note", x: 300, y: 20, name: "Intro" },
      actor,
      boardId: "b1",
    });
    expect(ydoc.getMap("widgets").get(second.result.id).name).toBe("Intro");

    runCommand({
      ydoc,
      name: "board.item.update",
      input: { id, patch: { name: "" } },
      actor,
      boardId: "b1",
    });
    expect(ydoc.getMap("widgets").get(id).name).toBeUndefined();
  });

  it("refuses a name longer than 120 characters", () => {
    const { ydoc, id } = docWithNote();
    expect(() =>
      runCommand({
        ydoc,
        name: "board.item.update",
        input: { id, patch: { name: "x".repeat(121) } },
        actor,
        boardId: "b1",
      }),
    ).toThrow(expect.objectContaining({ code: "BAD_INPUT" }));
  });

  it("sets text without touching geometry", () => {
    const { ydoc, id } = docWithNote();
    runCommand({
      ydoc,
      name: "board.text.set",
      input: { id, text: "Body" },
      actor,
      boardId: "b1",
    });
    expect(ydoc.getMap("texts").get(id).toString()).toBe("Body");
    expect(ydoc.getMap("widgets").get(id).x).toBe(10);
  });

  it("connects two objects and refuses a self-loop or a container", () => {
    const { ydoc, id } = docWithNote();
    const second = runCommand({
      ydoc,
      name: "board.item.create",
      input: { type: "text", x: 300, y: 20, content: "B" },
      actor,
      boardId: "b1",
    });
    const link = runCommand({
      ydoc,
      name: "board.connector.create",
      input: { from: id, to: second.result.id },
      actor,
      boardId: "b1",
    });
    expect(ydoc.getMap("widgets").get(link.result.id)).toMatchObject({
      type: "connector",
      start: { item: id },
      end: { item: second.result.id },
    });

    expect(() =>
      runCommand({
        ydoc,
        name: "board.connector.create",
        input: { from: id, to: id },
        actor,
        boardId: "b1",
      }),
    ).toThrow(expect.objectContaining({ code: "SELF_LOOP" }));

    // A frame is a container: it exists in the document but cannot be an endpoint.
    ydoc.getMap("widgets").set("frame-1", {
      id: "frame-1",
      type: "frame",
      parentId: null,
      x: 0,
      y: 0,
      width: 400,
      height: 300,
    });
    expect(() =>
      runCommand({
        ydoc,
        name: "board.connector.create",
        input: { from: id, to: "frame-1" },
        actor,
        boardId: "b1",
      }),
    ).toThrow(expect.objectContaining({ code: "NOT_CONNECTABLE" }));
  });

  it("deletes an object and the connectors that pointed at it", () => {
    const { ydoc, id } = docWithNote();
    const second = runCommand({
      ydoc,
      name: "board.item.create",
      input: { type: "text", x: 300, y: 20 },
      actor,
      boardId: "b1",
    });
    const link = runCommand({
      ydoc,
      name: "board.connector.create",
      input: { from: id, to: second.result.id },
      actor,
      boardId: "b1",
    });
    const removed = runCommand({
      ydoc,
      name: "board.item.delete",
      input: { id },
      actor,
      boardId: "b1",
    });
    expect(removed.result.connectors).toBe(1);
    expect(ydoc.getMap("widgets").has(id)).toBe(false);
    expect(ydoc.getMap("widgets").has(link.result.id)).toBe(false);
  });

  it("derives a stable id from an idempotency key and refuses a second apply", () => {
    const first = docWithNote();
    const created = runCommand({
      ydoc: first.ydoc,
      name: "board.item.create",
      input: { type: "text", x: 0, y: 0 },
      actor,
      boardId: "b1",
      idempotencyKey: "key-1",
    });
    expect(created.result.id).toBe(
      commandObjectId({
        boardId: "b1",
        actorId: actor.id,
        key: "board.item.create:key-1",
        prefix: "item",
      }),
    );
    // The HTTP layer replays the recorded result before apply; a second apply must not
    // silently overwrite the object (it could be locked).
    expect(() =>
      runCommand({
        ydoc: first.ydoc,
        name: "board.item.create",
        input: { type: "text", x: 0, y: 0 },
        actor,
        boardId: "b1",
        idempotencyKey: "key-1",
      }),
    ).toThrow(expect.objectContaining({ code: "OBJECT_EXISTS", status: 409 }));

    const one = runCommand({
      ydoc: first.ydoc,
      name: "board.item.create",
      input: { type: "text", x: 0, y: 0 },
      actor,
      boardId: "b1",
    });
    const two = runCommand({
      ydoc: first.ydoc,
      name: "board.item.create",
      input: { type: "text", x: 0, y: 0 },
      actor,
      boardId: "b1",
    });
    expect(one.result.id).not.toBe(two.result.id);
  });

  it("keeps waypoints, style and agent provenance, and refuses a duplicate pair", () => {
    const { ydoc, id } = docWithNote();
    const second = runCommand({
      ydoc,
      name: "board.item.create",
      input: { type: "text", x: 300, y: 20 },
      actor,
      boardId: "b1",
    });
    const created = runCommand({
      ydoc,
      name: "board.connector.create",
      input: {
        from: id,
        to: second.result.id,
        routing: "curved",
        waypoints: [{ id: "w1", x: 200, y: 100 }],
        style: { strokeColor: "#123456", strokeWidth: 3 },
      },
      actor: { type: "agent", id: "a1", name: "Scout" },
      agent: { id: "a1", name: "Scout", taskId: "t1", skill: "change-set" },
      boardId: "b1",
    });
    expect(ydoc.getMap("widgets").get(created.result.id)).toMatchObject({
      routing: "curved",
      createdBy: "Scout",
      agent: { id: "a1", skill: "change-set" },
      waypoints: [{ id: "w1", x: 200, y: 100, rigid: true }],
      style: { strokeColor: "#123456", strokeWidth: 3 },
    });
    expect(() =>
      runCommand({
        ydoc,
        name: "board.connector.create",
        input: { from: id, to: second.result.id },
        actor,
        boardId: "b1",
      }),
    ).toThrow(expect.objectContaining({ code: "CONNECTOR_EXISTS", status: 409 }));
  });

  it("changes routing and waypoints through the update command", () => {
    const { ydoc, id } = docWithNote();
    const second = runCommand({
      ydoc,
      name: "board.item.create",
      input: { type: "text", x: 300, y: 20 },
      actor,
      boardId: "b1",
    });
    const link = runCommand({
      ydoc,
      name: "board.connector.create",
      input: { from: id, to: second.result.id },
      actor,
      boardId: "b1",
    });
    runCommand({
      ydoc,
      name: "board.connector.update",
      input: {
        id: link.result.id,
        routing: "straight",
        waypoints: [{ id: "w2", x: 220, y: 40 }],
      },
      actor,
      boardId: "b1",
    });
    expect(ydoc.getMap("widgets").get(link.result.id)).toMatchObject({
      routing: "straight",
      waypoints: [{ id: "w2", x: 220, y: 40, rigid: true }],
    });
  });

  it("names bad input and unknown commands", () => {
    const ydoc = new Y.Doc();
    expect(() =>
      runCommand({ ydoc, name: "board.nope", input: {}, actor, boardId: "b1" }),
    ).toThrow(expect.objectContaining({ code: "UNKNOWN_COMMAND", status: 404 }));
    expect(() =>
      runCommand({
        ydoc,
        name: "board.item.create",
        input: { type: "kanban", x: 0, y: 0 },
        actor,
        boardId: "b1",
      }),
    ).toThrow(expect.objectContaining({ code: "BAD_INPUT" }));
    expect(() =>
      runCommand({
        ydoc,
        name: "board.item.update",
        input: { id: "missing", patch: { x: 1 } },
        actor,
        boardId: "b1",
      }),
    ).toThrow(CommandError);
  });
});

describe("author lock in commands (ADR-107)", () => {
  it("records the author and refuses another editor's unlock", () => {
    const { ydoc, id } = docWithNote();
    runCommand({
      ydoc,
      name: "board.item.update",
      input: { id, patch: { locked: true } },
      actor,
      boardId: "b1",
    });
    expect(ydoc.getMap("widgets").get(id)).toMatchObject({
      locked: true,
      lockedBy: "u1",
      lockedByName: "Alex",
    });

    expect(() =>
      runCommand({
        ydoc,
        name: "board.item.update",
        input: { id, patch: { locked: false } },
        actor: { type: "user", id: "u2", name: "Bob" },
        capabilities: ["board.edit"],
        boardId: "b1",
      }),
    ).toThrow(expect.objectContaining({ code: "LOCKED_BY_OTHER", status: 409 }));

    runCommand({
      ydoc,
      name: "board.item.update",
      input: { id, patch: { locked: false } },
      actor,
      boardId: "b1",
    });
    expect(ydoc.getMap("widgets").get(id).locked).toBeUndefined();
    expect(ydoc.getMap("widgets").get(id).lockedBy).toBeUndefined();
  });

  it("lets a board manager unlock, and refuses edits while locked", () => {
    const { ydoc, id } = docWithNote();
    runCommand({
      ydoc,
      name: "board.item.update",
      input: { id, patch: { locked: true } },
      actor,
      boardId: "b1",
    });

    expect(() =>
      runCommand({
        ydoc,
        name: "board.item.update",
        input: { id, patch: { x: 5 } },
        actor,
        boardId: "b1",
      }),
    ).toThrow(expect.objectContaining({ code: "OBJECT_LOCKED" }));

    expect(() =>
      runCommand({
        ydoc,
        name: "board.item.delete",
        input: { id },
        actor,
        boardId: "b1",
      }),
    ).toThrow(expect.objectContaining({ code: "OBJECT_LOCKED" }));

    runCommand({
      ydoc,
      name: "board.item.update",
      input: { id, patch: { locked: false } },
      actor: { type: "user", id: "u2", name: "Bob" },
      capabilities: ["board.edit", "board.manage"],
      boardId: "b1",
    });
    expect(ydoc.getMap("widgets").get(id).locked).toBeUndefined();
  });
});

describe("markdown text (ADR-252 §11 stage 7)", () => {
  it("creates a formatted object from markdown in one transaction", () => {
    const ydoc = new Y.Doc();
    const created = runCommand({
      ydoc,
      name: "board.item.create",
      input: {
        type: "sticky_note",
        x: 0,
        y: 0,
        markdown: "# Sprint\n\n- one\n- [x] two",
      },
      actor,
      boardId: "b1",
    });
    const id = created.result.id;
    const widget = ydoc.getMap("widgets").get(id);
    const delta = ydoc.getMap("texts").get(id).toDelta();

    expect(widget).toMatchObject({ type: "sticky_note", content: "Sprint\n\none\ntwo" });
    expect(linesOf(delta).map((line) => line.block)).toEqual(["h1", undefined, "bullet", "check"]);
    expect(toMarkdown(delta)).toBe("# Sprint\n\n- one\n- [x] two");
  });

  it("replaces the text with markdown through the update command", () => {
    const { ydoc, id } = docWithNote();
    runCommand({
      ydoc,
      name: "board.item.update",
      input: { id, patch: { markdown: "- first\n- second" } },
      actor,
      boardId: "b1",
    });
    const text = ydoc.getMap("texts").get(id);
    expect(ydoc.getMap("widgets").get(id).content).toBe("first\nsecond");
    expect(linesOf(text.toDelta()).map((line) => line.block)).toEqual(["bullet", "bullet"]);
  });

  it("refuses text and markdown together, and markdown on a frame", () => {
    const ydoc = new Y.Doc();
    expect(() =>
      runCommand({
        ydoc,
        name: "board.item.create",
        input: { type: "text", x: 0, y: 0, content: "plain", markdown: "**rich**" },
        actor,
        boardId: "b1",
      }),
    ).toThrow(expect.objectContaining({ code: "TEXT_CONFLICT", status: 422 }));

    const { ydoc: doc, id } = docWithNote();
    expect(() =>
      runCommand({
        ydoc: doc,
        name: "board.item.update",
        input: { id, patch: { content: "plain", markdown: "**rich**" } },
        actor,
        boardId: "b1",
      }),
    ).toThrow(expect.objectContaining({ code: "TEXT_CONFLICT", status: 422 }));

    expect(() =>
      runCommand({
        ydoc,
        name: "board.item.create",
        input: { type: "frame", x: 0, y: 0, markdown: "# no" },
        actor,
        boardId: "b1",
      }),
    ).toThrow(expect.objectContaining({ code: "NOT_TEXT", status: 422 }));
  });

  it("keeps plain text on the plain path and drops HTML from markdown", () => {
    const ydoc = new Y.Doc();
    const plain = runCommand({
      ydoc,
      name: "board.item.create",
      input: { type: "text", x: 0, y: 0, content: "**not bold**" },
      actor,
      boardId: "b1",
    });
    // Markdown sent as `content` stays literal: the field is the simple path.
    expect(ydoc.getMap("texts").get(plain.result.id).toString()).toBe("**not bold**");

    const rich = runCommand({
      ydoc,
      name: "board.item.create",
      input: {
        type: "text",
        x: 300,
        y: 0,
        markdown: "**bold** <script>alert(1)</script>after [x](javascript:alert(1))",
      },
      actor,
      boardId: "b1",
    });
    const text = ydoc.getMap("texts").get(rich.result.id);
    expect(toMarkdown(text.toDelta())).toBe("**bold** after x");
    expect(ydoc.getMap("widgets").get(rich.result.id).content).toBe("bold after x");
  });
});

describe("two-sided sticky notes (ADR-320)", () => {
  function docWithFrame() {
    const ydoc = new Y.Doc();
    const frame = runCommand({
      ydoc,
      name: "board.item.create",
      input: { type: "frame", x: 0, y: 0, width: 600, height: 400 },
      actor,
      boardId: "b1",
    });
    return { ydoc, frameId: frame.result.id };
  }

  function noteWithBack(ydoc, frameId, back = "Answer") {
    return runCommand({
      ydoc,
      name: "board.item.create",
      input: {
        type: "sticky_note",
        x: 20,
        y: 20,
        parentId: frameId,
        content: "Question",
        back,
      },
      actor,
      boardId: "b1",
    });
  }

  it("creates both texts in one transaction and one event", () => {
    const { ydoc, frameId } = docWithFrame();
    const created = noteWithBack(ydoc, frameId);
    const id = created.result.id;
    expect(ydoc.getMap("texts").get(id).toString()).toBe("Question");
    expect(ydoc.getMap("texts").get(backTextKey(id)).toString()).toBe("Answer");
    expect(ydoc.getMap("widgets").get(id).back).toBeUndefined();
    expect(created.events).toEqual([
      { type: "board.item.created", subject: id, payload: { objectType: "sticky_note" } },
    ]);
  });

  it("refuses a back on anything but a sticky note, and both text paths at once", () => {
    const { ydoc, frameId } = docWithFrame();
    expect(() =>
      runCommand({
        ydoc,
        name: "board.item.create",
        input: { type: "text", x: 0, y: 0, back: "Answer" },
        actor,
        boardId: "b1",
      }),
    ).toThrow(expect.objectContaining({ code: "NOT_TEXT" }));
    expect(() => noteWithBack(ydoc, frameId, undefined)).not.toThrow();
    expect(() =>
      runCommand({
        ydoc,
        name: "board.item.create",
        input: { type: "sticky_note", x: 0, y: 0, back: "A", backMarkdown: "**A**" },
        actor,
        boardId: "b1",
      }),
    ).toThrow(expect.objectContaining({ code: "TEXT_CONFLICT" }));
  });

  it("updates, preserves, clears and formats the back side", () => {
    const { ydoc, frameId } = docWithFrame();
    const id = noteWithBack(ydoc, frameId).result.id;

    const updated = runCommand({
      ydoc,
      name: "board.item.update",
      input: { id, patch: { back: "Second" } },
      actor,
      boardId: "b1",
    });
    expect(updated.result.changed).toContain("back");
    expect(ydoc.getMap("texts").get(backTextKey(id)).toString()).toBe("Second");

    runCommand({
      ydoc,
      name: "board.item.update",
      input: { id, patch: { x: 30 } },
      actor,
      boardId: "b1",
    });
    expect(ydoc.getMap("texts").get(backTextKey(id)).toString()).toBe("Second");

    runCommand({
      ydoc,
      name: "board.item.update",
      input: { id, patch: { backMarkdown: "**Bold**" } },
      actor,
      boardId: "b1",
    });
    const richBack = ydoc.getMap("texts").get(backTextKey(id));
    expect(richBack.toDelta().map((op) => op.insert).join("")).toBe("Bold");

    runCommand({
      ydoc,
      name: "board.item.update",
      input: { id, patch: { back: null } },
      actor,
      boardId: "b1",
    });
    expect(ydoc.getMap("texts").has(backTextKey(id))).toBe(false);
  });

  it("refuses a back update on a locked sticker", () => {
    const { ydoc, frameId } = docWithFrame();
    const id = noteWithBack(ydoc, frameId).result.id;
    runCommand({
      ydoc,
      name: "board.item.update",
      input: { id, patch: { locked: true } },
      actor,
      boardId: "b1",
    });
    expect(() =>
      runCommand({
        ydoc,
        name: "board.item.update",
        input: { id, patch: { back: "No" } },
        actor,
        boardId: "b1",
      }),
    ).toThrow(expect.objectContaining({ code: "OBJECT_LOCKED" }));
  });

  it("shows and hides answers with one state and one event", () => {
    const { ydoc, frameId } = docWithFrame();
    noteWithBack(ydoc, frameId);

    const shown = runCommand({
      ydoc,
      name: "board.frame.answers",
      input: { frameId, target: "answers" },
      actor,
      boardId: "b1",
    });
    expect(shown.result).toMatchObject({
      id: frameId,
      frameId,
      target: "answers",
      changed: true,
      count: 1,
    });
    expect(ydoc.getMap("meta").get(answersKey(frameId))).toBe("1");
    expect(shown.events).toEqual([
      {
        type: "board.frame.answers",
        subject: frameId,
        payload: { target: "answers", count: 1 },
      },
    ]);

    const again = runCommand({
      ydoc,
      name: "board.frame.answers",
      input: { frameId, target: "answers" },
      actor,
      boardId: "b1",
    });
    expect(again.result.changed).toBe(false);
    expect(again.events).toEqual([]);

    const hidden = runCommand({
      ydoc,
      name: "board.frame.answers",
      input: { frameId, target: "questions" },
      actor,
      boardId: "b1",
    });
    expect(hidden.result.changed).toBe(true);
    expect(ydoc.getMap("meta").has(answersKey(frameId))).toBe(false);
  });

  it("allows a shown frame with no back sides and refuses a non-frame", () => {
    const { ydoc, frameId } = docWithFrame();
    const empty = runCommand({
      ydoc,
      name: "board.frame.answers",
      input: { frameId, target: "answers" },
      actor,
      boardId: "b1",
    });
    expect(empty.result).toMatchObject({ changed: true, count: 0 });

    const note = noteWithBack(ydoc, frameId);
    expect(() =>
      runCommand({
        ydoc,
        name: "board.frame.answers",
        input: { frameId: note.result.id, target: "answers" },
        actor,
        boardId: "b1",
      }),
    ).toThrow(expect.objectContaining({ code: "BAD_INPUT" }));
  });

  it("validates the target and the white list", () => {
    const { ydoc, frameId } = docWithFrame();
    expect(() =>
      runCommand({
        ydoc,
        name: "board.frame.answers",
        input: { frameId, target: "maybe" },
        actor,
        boardId: "b1",
      }),
    ).toThrow(expect.objectContaining({ code: "BAD_INPUT" }));
    expect(() =>
      runCommand({
        ydoc,
        name: "board.frame.answers",
        input: { frameId, target: "answers", extra: 1 },
        actor,
        boardId: "b1",
      }),
    ).toThrow(expect.objectContaining({ code: "BAD_INPUT" }));
    expect(COMMANDS["board.frame.answers"].capabilities).toEqual(["board.facilitate"]);
  });
});
