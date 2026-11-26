import { hintVariant } from "./hintRegistry";
import { describe, expect, it } from "vitest";
import {
  HINT_KEY_PREFIX,
  hintLearned,
  markHintDone,
  markHintVisit,
  readHint,
  resetHints,
} from "./hints";

/** The rule is about storage, not about a browser: a map is enough (ADR-289). */
class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

describe("once hints (ADR-266 §6, ADR-289)", () => {
  it("goes away after three actions, and not before", () => {
    const storage = new MemoryStorage();
    markHintDone("canvas.doubleClickEdit", storage);
    markHintDone("canvas.doubleClickEdit", storage);
    expect(hintLearned("canvas.doubleClickEdit", storage)).toBe(false);
    markHintDone("canvas.doubleClickEdit", storage);
    expect(hintLearned("canvas.doubleClickEdit", storage)).toBe(true);
    expect(readHint("canvas.doubleClickEdit", storage)).toEqual({ done: 3, visits: 0 });
  });

  it("goes away after five visits even when nobody used the action", () => {
    const storage = new MemoryStorage();
    for (let visit = 0; visit < 4; visit += 1) {
      markHintVisit("canvas.doubleClickEdit", storage);
    }
    expect(hintLearned("canvas.doubleClickEdit", storage)).toBe(false);
    markHintVisit("canvas.doubleClickEdit", storage);
    expect(hintLearned("canvas.doubleClickEdit", storage)).toBe(true);
  });

  it("resetting brings a learned hint back", () => {
    const storage = new MemoryStorage();
    for (let use = 0; use < 3; use += 1) markHintDone("canvas.doubleClickEdit", storage);
    expect(hintLearned("canvas.doubleClickEdit", storage)).toBe(true);
    resetHints(storage);
    expect(storage.getItem(`${HINT_KEY_PREFIX}canvas.doubleClickEdit`)).toBeNull();
    expect(hintLearned("canvas.doubleClickEdit", storage)).toBe(false);
    expect(readHint("canvas.doubleClickEdit", storage)).toEqual({ done: 0, visits: 0 });
  });

  it("reads the old one-visit key as learned, and reset forgets it too", () => {
    const storage = new MemoryStorage();
    // A visit may already have written a fresh count before the old key is read: the
    // old promise still wins until the hints are reset (ADR-289).
    storage.setItem(`${HINT_KEY_PREFIX}canvas.doubleClickEdit`, JSON.stringify({ done: 1, visits: 1 }));
    storage.setItem("remo.canvas.hint", "seen");
    expect(hintLearned("canvas.doubleClickEdit", storage)).toBe(true);
    resetHints(storage);
    expect(storage.getItem("remo.canvas.hint")).toBeNull();
    expect(hintLearned("canvas.doubleClickEdit", storage)).toBe(false);
  });

  it("survives a broken or hostile record instead of showing nonsense", () => {
    const storage = new MemoryStorage();
    storage.setItem(`${HINT_KEY_PREFIX}canvas.doubleClickEdit`, "{not json");
    expect(readHint("canvas.doubleClickEdit", storage)).toEqual({ done: 0, visits: 0 });
    storage.setItem(
      `${HINT_KEY_PREFIX}canvas.doubleClickEdit`,
      JSON.stringify({ done: -4, visits: "many" }),
    );
    expect(readHint("canvas.doubleClickEdit", storage)).toEqual({ done: 0, visits: 0 });
  });
});

describe("rotating copy (ADR-268)", () => {
  it("cycles through empty-room headings on successive visits", () => {
    const context = { canInvite: true, hasPeers: false };
    expect([0, 1, 2, 3].map((visit) => hintVariant("room.empty", visit, context).intent))
      .toEqual(["action", "benefit", "together", "action"]);
  });

  it("counts only variants that apply to this room and viewer", () => {
    for (const context of [{ canInvite: false }, { canInvite: true, hasPeers: true }]) {
      expect([0, 1, 2, 3].map((visit) => hintVariant("room.empty", visit, context).intent))
        .toEqual(["action", "benefit", "action", "benefit"]);
    }
  });

  it("varies an instructional plate without changing its learning rule", () => {
    expect(hintVariant("canvas.doubleClickEdit", 0).key).toBe("canvas.hint");
    expect(hintVariant("canvas.doubleClickEdit", 1).intent).toBe("benefit");
    expect(hintVariant("canvas.doubleClickEdit", 2).key).toBe("canvas.hint");
  });
});
