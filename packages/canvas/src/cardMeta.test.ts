import { describe, expect, it } from "vitest";
import type { Widget } from "@remo/model";
import { CARD_FACE_TAGS, drawCardMeta, faceTags } from "./cardMeta";
import { DEFAULT_PALETTE } from "./palette";

/** Records text geometry and the font used to measure it in world units. */
function recordText() {
  const seen: Array<{ label: string; x: number; y: number; font: string; align: unknown }> = [];
  const state: Record<string | symbol, unknown> = {};
  const ctx = new Proxy(state, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === "measureText") return (label: string) => ({ width: label.length * 6 });
      if (key === "fillText") {
        return (label: string, x: number, y: number) =>
          seen.push({ label, x, y, font: String(target.font), align: target.textAlign });
      }
      return () => {};
    },
    set(target, key, value) {
      target[key] = value;
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, seen };
}

describe("card small print (ADR-235)", () => {
  it("is drawn in world units, so it scales with the card like its title", () => {
    const card = { id: "c", type: "card", status: "in_progress", dueAt: "2026-10-31" } as unknown as Widget;
    const { ctx, seen } = recordText();
    drawCardMeta(ctx, 0, 0, 250, 70, card, {
      fontFamily: "Inter",
      palette: DEFAULT_PALETTE,
      ink: { color: "#1e2136", halo: null },
      statusLabel: { todo: "To do", in_progress: "In progress", done: "Done" },
    });
    expect(seen.length).toBeGreaterThan(0);
    for (const { font } of seen) expect(font).toMatch(/^9\.5px /);
  });
});

describe("tags on a card face (ADR-106)", () => {
  const vocabulary = new Map([
    ["t1", { name: "Важно", color: "red" as const }],
    ["t2", { name: "UX", color: "blue" as const }],
    ["t3", { name: "Q4", color: "green" as const }],
    ["t4", { name: "Later", color: "gray" as const }],
  ]);

  it("shows at most three, in the card's order, and skips a deleted tag", () => {
    const card = { id: "c", type: "card", tagIds: ["t2", "gone", "t1", "t3", "t4"] } as unknown as Widget;
    expect(faceTags(card, vocabulary).map((tag) => tag.name)).toEqual(["UX", "Важно", "Q4"]);
    expect(CARD_FACE_TAGS).toBe(3);
  });

  it("draws the tag names on the face", () => {
    const texts: string[] = [];
    const state: Record<string | symbol, unknown> = {};
    const ctx = new Proxy(state, {
      get(target, key) {
        if (key in target) return target[key];
        if (key === "measureText") return () => ({ width: 10 });
        return (...args: unknown[]) => {
          if (key === "fillText") texts.push(String(args[0]));
        };
      },
      set(target, key, value) {
        target[key] = value;
        return true;
      },
    }) as unknown as CanvasRenderingContext2D;
    const card = { id: "c", type: "card", tagIds: ["t1"], status: "todo" } as unknown as Widget;
    drawCardMeta(ctx, 0, 0, 250, 70, card, {
      fontFamily: "Inter",
      palette: DEFAULT_PALETTE,
      ink: { color: "#1e2136", halo: null },
      statusLabel: { todo: "To do", in_progress: "In progress", done: "Done" },
      tags: vocabulary,
    });
    expect(texts).toContain("Важно");
  });
});

describe("the card face is paper and ink (ADR-267 §2.1)", () => {
  it("paints the assignee in the person's colour and a tag as an outlined plate", () => {
    const texts: string[] = [];
    const fills: string[] = [];
    const strokes: string[] = [];
    const state: Record<string | symbol, unknown> = {};
    const ctx = new Proxy(state, {
      get(target, key) {
        if (key in target) return target[key];
        if (key === "measureText") return (text: string) => ({ width: String(text).length * 6 });
        return (...args: unknown[]) => {
          if (key === "fillText") texts.push(String(args[0]));
          if (key === "fill" && typeof state.fillStyle === "string") fills.push(state.fillStyle);
          if (key === "stroke" && typeof state.strokeStyle === "string") strokes.push(state.strokeStyle);
        };
      },
      set(target, key, value) {
        target[key] = value;
        return true;
      },
    }) as unknown as CanvasRenderingContext2D;

    const card = {
      id: "c",
      type: "card",
      tagIds: ["t1"],
      assigneeId: "acc-1",
      assigneeName: "Аня Петрова",
    } as unknown as Widget;
    drawCardMeta(ctx, 0, 0, 260, 70, card, {
      fontFamily: "Inter",
      palette: DEFAULT_PALETTE,
      ink: { color: "#1e2136", halo: null },
      statusLabel: { todo: "To do", in_progress: "In progress", done: "Done" },
      tags: new Map([["t1", { name: "Важно", color: "red" as const }]]),
      assigneeColor: () => "#c93e0a",
    });

    expect(fills).toContain("#c93e0a");
    expect(fills).toContain(DEFAULT_PALETTE.objectPaper);
    expect(strokes.every((colour) => colour === "#1e2136")).toBe(true);
    expect(texts).toContain("АП");
    expect(texts).toContain("Важно");
  });
});

describe("card footer layout (App-Kanban/card-fields)", () => {
  function paint(fields: Partial<Widget>, width: number, height = 79) {
    const { ctx, seen } = recordText();
    const card: Widget = { id: "c", type: "card", parentId: null, x: 0, y: 0, width, height, ...fields };
    const titleY = drawCardMeta(ctx, 0, 0, width, height, card, {
      fontFamily: "Inter",
      palette: DEFAULT_PALETTE,
      ink: { color: "#1e2136", halo: null },
      statusLabel: { todo: "To do", in_progress: "In progress", done: "Done" },
      tags: new Map([
        ["a", { name: "Важно", color: "red" }],
        ["b", { name: "UX", color: "blue" }],
        ["c", { name: "Q4", color: "green" }],
      ]),
    });
    function at(label: string) {
      const item = seen.find(item => item.label === label);
      expect(item, label).toBeDefined();
      return item!;
    }
    return { at, seen, titleY };
  }

  it("keeps the tag on the left and the due date immediately before the rightmost avatar", () => {
    const { at } = paint({ tagIds: ["a"], dueAt: "1999-06-30", assigneeName: "Аня Петрова", status: "todo" }, 240);
    const tag = at("Важно"), date = at("! 06.30"), avatar = at("АП");
    expect(tag.y).toBe(date.y);
    expect(date.y).toBe(avatar.y);
    expect(tag.x + tag.label.length * 6).toBeLessThan(date.x - date.label.length * 6);
    expect(date.align).toBe("right");
    expect(date.x).toBeLessThan(avatar.x - 7);
    expect(avatar.align).toBe("center");
    expect(avatar.x + 7).toBe(240 - 12);
    expect(at("To do").y).toBeLessThan(tag.y);
  });

  it("wraps a prefix of tags without covering the title, dates, or initials", () => {
    const { at, titleY } = paint({ tagIds: ["a", "b", "c"], startAt: "2099-06-01", dueAt: "2099-06-30", assigneeName: "Илья" }, 170);
    const first = at("Важно"), second = at("UX"), last = at("Q4");
    const date = at("06.01 — 06.30");
    expect(first.y).toBe(second.y);
    expect(first.x).toBeLessThan(second.x);
    expect(first.y - 7).toBeGreaterThan(titleY + 12);
    expect(first.y + 14).toBeLessThanOrEqual(last.y);
    expect(last.y).toBe(date.y);
    expect(last.x + 2 * 6 + 6).toBeLessThan(date.x - date.label.length * 6);
    expect(at("И").y).toBe(date.y);
  });

  it("uses the full row for a date range that cannot fit beside the avatar", () => {
    const { at } = paint({ startAt: "2099-06-01", dueAt: "2099-06-30", assigneeName: "Илья" }, 112);
    const date = at("06.01 — 06.30");
    expect(date.x - date.label.length * 6).toBeGreaterThanOrEqual(12);
    expect(date.y).toBeLessThan(at("И").y);
  });

  it("requires no empty date slot when only an assignee is present", () => {
    const { at } = paint({ assigneeName: "Илья" }, 65, 48);
    expect(at("И").x + 7).toBe(65 - 12);
    expect(paint({}, 65, 48).titleY).toBe(24);
  });
});
