import { describe, expect, it } from "vitest";
import { ObjectHand } from "./objectHand";

const note = "sticky_1";

describe("sheets in hand (ADR-265 §4.2)", () => {
  it("lifts a hovered note to one in 220 ms and drops it when the pointer leaves", () => {
    const hand = new ObjectHand();
    hand.update(0, { hoverId: note, dragIds: [], calm: false });
    expect(hand.handOf(note, 0)).toBe(0);
    expect(hand.handOf(note, 110)).toBeGreaterThan(0.5);
    expect(hand.handOf(note, 220)).toBe(1);
    expect(hand.moving(220)).toBe(false);

    hand.update(300, { hoverId: null, dragIds: [], calm: false });
    expect(hand.handOf(note, 300)).toBe(0);
  });

  it("keeps a carried note in hand and settles it after the drop", () => {
    const hand = new ObjectHand();
    hand.update(0, { hoverId: note, dragIds: [note], calm: false });
    expect(hand.handOf(note, 0)).toBe(1);
    expect(hand.handOf(note, 5_000)).toBe(1);

    hand.update(5_000, { hoverId: null, dragIds: [], calm: false });
    // The drop starts from the carried state and presses slightly in on the way down.
    expect(hand.handOf(note, 5_000)).toBe(1);
    expect(hand.moving(5_100)).toBe(true);
    expect(hand.handOf(note, 5_700)).toBe(0);
    expect(hand.moving(5_700)).toBe(false);
  });

  it("does nothing under calm motion or with an empty room", () => {
    const hand = new ObjectHand();
    hand.update(0, { hoverId: note, dragIds: [], calm: true });
    expect(hand.handOf(note, 100)).toBe(0);
    expect(hand.moving(0)).toBe(false);
    hand.update(0, { hoverId: null, dragIds: [], calm: false });
    expect(hand.handOf("other", 0)).toBe(0);
  });
});
