import { describe, expect, it } from "vitest";
import type { Widget } from "@remo/model";
import { CARD_FACE_TAGS, drawCardMeta, faceTags } from "./cardMeta";
import { DEFAULT_PALETTE } from "./palette";

/** Records the font in force at every fillText. */
function fonts() {
  const seen: string[] = [];
  const state: Record<string | symbol, unknown> = {};
  const ctx = new Proxy(state, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === "measureText") return () => ({ width: 10 });
      return () => {
        if (key === "fillText") seen.push(String(target.font));
      };
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
    const { ctx, seen } = fonts();
    drawCardMeta(ctx, 0, 0, 250, 70, card, {
      fontFamily: "Inter",
      palette: DEFAULT_PALETTE,
      ink: { color: "#1e2136", halo: null },
      statusLabel: { todo: "To do", in_progress: "In progress", done: "Done" },
    });
    expect(seen.length).toBeGreaterThan(0);
    for (const font of seen) expect(font).toMatch(/^9\.5px /);
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
