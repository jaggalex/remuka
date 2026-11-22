import { describe, expect, it } from "vitest";
import { finiteOr, readTag, readWidget } from "./sanitize";
import type { Widget } from "./types";

const note: Widget = {
  id: "n1",
  type: "sticky_note",
  parentId: null,
  x: 10,
  y: 20,
  width: 200,
  height: 120,
  content: "hello",
  tagIds: ["t1"],
  style: { fillColor: "#ffd02f", fontSize: 24, textAlign: "center" },
  link: { kind: "url", url: "https://example.com/" },
};

describe("readWidget (ADR-171)", () => {
  it("returns a valid widget as the same object, without a copy", () => {
    expect(readWidget(note, "n1")).toBe(note);
  });

  it("skips a value that is not an object at all", () => {
    expect(readWidget(null, "x")).toBeNull();
    expect(readWidget("sticky", "x")).toBeNull();
    expect(readWidget(42, "x")).toBeNull();
    expect(readWidget([note], "x")).toBeNull();
  });

  it("forces the identity fields into shape", () => {
    const repaired = readWidget(
      { id: "other", type: "rocket", x: "1", y: Number.NaN, width: -5, height: Infinity, parentId: 7 },
      "w1",
    );
    expect(repaired).toMatchObject({
      id: "w1",
      type: "unsupported",
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      parentId: null,
    });
  });

  it("drops an optional field of the wrong shape and keeps the rest", () => {
    const repaired = readWidget(
      { ...note, content: { evil: true }, rotation: "90", locked: "yes", status: "blocked", z: 3 },
      "n1",
    );
    expect(repaired).not.toHaveProperty("content");
    expect(repaired).not.toHaveProperty("rotation");
    expect(repaired).not.toHaveProperty("locked");
    expect(repaired).not.toHaveProperty("status");
    expect(repaired?.z).toBe(3);
    expect(repaired?.tagIds).toEqual(["t1"]);
  });

  it("drops the fields the model no longer has, even when they look valid (ADR-209)", () => {
    const repaired = readWidget(
      {
        ...note,
        rotation: 0.5,
        style: { ...note.style, fontFamily: "Georgia, serif" },
      },
      "n1",
    );
    expect(repaired).not.toHaveProperty("rotation");
    expect(repaired?.style).not.toHaveProperty("fontFamily");
    // The rest of the style is untouched, and the widget is not copied without a reason.
    expect(repaired?.style?.fillColor).toBe("#ffd02f");
  });

  it("never lets an unsafe link through, whoever wrote it", () => {
    for (const url of ["javascript:alert(1)", "data:text/html,x", "https://u:p@example.com"]) {
      expect(readWidget({ ...note, link: { kind: "url", url } }, "n1")).not.toHaveProperty("link");
    }
    expect(readWidget({ ...note, link: { kind: "widget", widgetId: 5 } }, "n1")).not.toHaveProperty(
      "link",
    );
    expect(readWidget({ ...note, link: { kind: "widget", widgetId: "n2" } }, "n1")?.link).toEqual({
      kind: "widget",
      widgetId: "n2",
    });
  });

  it("repairs style field by field", () => {
    const repaired = readWidget(
      {
        ...note,
        style: { fillColor: 12, fontSize: -4, strokeWidth: 2, textAlign: "justify", color: "#000" },
      },
      "n1",
    );
    expect(repaired?.style).toEqual({ strokeWidth: 2, color: "#000" });
    expect(readWidget({ ...note, style: ["red"] }, "n1")).not.toHaveProperty("style");
  });

  it("keeps an elevation only on a type that can stand off the board (ADR-245)", () => {
    const shape = { ...note, type: "shape" as const };
    expect(readWidget({ ...shape, style: { elevation: "floating" } }, "n1")?.style).toEqual({
      elevation: "floating",
    });
    expect(readWidget({ ...shape, style: { elevation: "hovering" } }, "n1")?.style).toEqual({});
    // A note has its own paper shadow: a pasted level is dropped, the rest stays.
    expect(
      readWidget({ ...note, style: { fillColor: "#ffd02f", elevation: "raised" } }, "n1")?.style,
    ).toEqual({ fillColor: "#ffd02f" });
  });

  it("filters arrays instead of discarding the object", () => {
    const waypoints = Array.from({ length: 40 }, (_, i) => ({ id: `p${i}`, x: i, y: i }));
    const repaired = readWidget(
      {
        id: "c1",
        type: "connector",
        parentId: null,
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        start: { item: "a", side: "left" },
        end: { item: 9 },
        waypoints: [...waypoints, { id: "bad", x: "1", y: 2 }],
        tagIds: ["t1", 2, null, "t2"],
        runs: [{ text: "ok", bold: true }, { text: 3 }],
      },
      "c1",
    );
    expect(repaired?.start).toEqual({ item: "a", side: "left" });
    expect(repaired).not.toHaveProperty("end");
    expect(repaired?.waypoints).toHaveLength(32);
    expect(repaired?.tagIds).toEqual(["t1", "t2"]);
    expect(repaired?.runs).toEqual([{ text: "ok", bold: true }]);
  });

  it("drops a timer that would make the countdown lie", () => {
    const timer = { durationMs: 60_000, endsAt: null, remainingMs: null, state: "idle", setBy: "A" };
    const base = { id: "t", type: "timer", parentId: null, x: 0, y: 0, width: 10, height: 10 };
    expect(readWidget({ ...base, timer }, "t")?.timer).toEqual(timer);
    expect(readWidget({ ...base, timer: { ...timer, state: "exploded" } }, "t")).not.toHaveProperty(
      "timer",
    );
  });

  it("keeps fields this build does not know (a newer client's data)", () => {
    const future = { ...note, futureField: { anything: 1 } };
    expect(readWidget(future, "n1")).toBe(future);
  });

  it("never throws on hostile input", () => {
    const hostile: unknown[] = [
      { style: null, link: null, runs: null, waypoints: null, timer: null, agent: null },
      { curve: { from: "a" }, labelAt: { t: "x" }, start: "a", end: [] },
      Object.create(null),
      { type: "__proto__", x: {}, y: [] },
    ];
    for (const value of hostile) expect(() => readWidget(value, "h")).not.toThrow();
  });

  it("does not accept a prototype key as a widget type", () => {
    for (const type of ["__proto__", "constructor", "toString"]) {
      expect(readWidget({ ...note, type }, "n1")?.type).toBe("unsupported");
    }
  });
});

describe("text attributes and lines (ADR-252 §2.6)", () => {
  it("leaves an old widget without runs or lines exactly as it is", () => {
    const old = { ...note, content: "plain, no attributes" };
    expect(readWidget(old, "n1")).toBe(old);
  });

  it("leaves a widget whose lines are already canonical as the same object", () => {
    const valid = {
      ...note,
      lines: [
        { runs: [{ text: "one", bold: true }], block: "h1", indent: 0, checked: false },
        { runs: [], indent: 0, checked: false },
      ],
    };
    expect(readWidget(valid, "n1")).toBe(valid);
  });

  it("repairs inline marks in runs: only true survives, unsafe links go", () => {
    const repaired = readWidget(
      {
        ...note,
        runs: [
          { text: "ok", bold: true, italic: "yes", code: true, href: "javascript:alert(1)" },
          { text: "link", href: "https://example.com" },
        ],
      },
      "n1",
    );
    expect(repaired?.runs).toEqual([
      { text: "ok", bold: true, code: true },
      { text: "link", href: "https://example.com/" },
    ]);
  });

  it("repairs a materialized line without turning it into another line", () => {
    const repaired = readWidget(
      {
        ...note,
        lines: [
          {
            runs: [{ text: "one", bold: true }],
            block: "ordered",
            indent: 2,
            checked: true,
            ordinal: 3,
          },
          {
            runs: [{ text: "two" }],
            block: "quote",
            indent: 7,
            checked: "yes",
            ordinal: "first",
          },
          { runs: "not a list", block: "h1" },
          "not a line",
        ],
      },
      "n1",
    );
    expect(repaired?.lines).toEqual([
      {
        runs: [{ text: "one", bold: true }],
        block: "ordered",
        indent: 2,
        checked: false,
        ordinal: 3,
      },
      { runs: [{ text: "two" }], indent: 0, checked: false },
      // A bad line keeps its index: `lines` is a position in the text, so dropping
      // one would move every later line. It becomes an empty ordinary line.
      { runs: [], block: "h1", indent: 0, checked: false },
      { runs: [], indent: 0, checked: false },
    ]);
  });

  it("keeps checked only on a checklist line and indent only on a list", () => {
    const line = (extra: Record<string, unknown>) => ({
      runs: [{ text: "x" }],
      indent: 0,
      checked: false,
      ...extra,
    });
    const repaired = readWidget(
      {
        ...note,
        lines: [
          line({ block: "h1", indent: 2, checked: true }),
          line({ block: "check", checked: true, indent: 1 }),
          line({ block: "bullet", indent: 2 }),
        ],
      },
      "n1",
    );
    expect(repaired?.lines).toEqual([
      { runs: [{ text: "x" }], indent: 0, checked: false, block: "h1" },
      { runs: [{ text: "x" }], indent: 1, checked: true, block: "check" },
      { runs: [{ text: "x" }], indent: 2, checked: false, block: "bullet" },
    ]);
  });

  it("drops a lines value that is not an array and never throws on rubbish", () => {
    expect(readWidget({ ...note, lines: "one line" }, "n1")).not.toHaveProperty("lines");
    for (const lines of [null, 1, {}, [null], [{ runs: null }], [{ runs: [{ text: 1 }] }]]) {
      expect(() => readWidget({ ...note, lines }, "n1")).not.toThrow();
    }
  });
});

describe("readTag", () => {
  it("keeps a valid tag and repairs a colour", () => {
    const tag = { id: "t1", name: "Risk", color: "red" };
    expect(readTag(tag, "t1")).toBe(tag);
    expect(readTag({ id: "t1", name: "Risk", color: "neon" }, "t1")?.color).toBe("gray");
    expect(readTag({ name: 1 }, "t1")).toBeNull();
    expect(readTag("Risk", "t1")).toBeNull();
  });
});

describe("finiteOr", () => {
  it("falls back for anything that is not a finite number", () => {
    expect(finiteOr(12, 0)).toBe(12);
    expect(finiteOr("12", 0)).toBe(12);
    expect(finiteOr("wide", 5)).toBe(5);
    expect(finiteOr(Infinity, 5)).toBe(5);
  });
});
