import { describe, expect, it } from "vitest";
import {
  STICKER_HOVER,
  STICKER_SETTLE,
  hoverHand,
  settleHand,
  stickerShadow,
} from "./stickerMotion";

describe("paper physics (ADR-265 §4.2)", () => {
  it("uses the owner's numbers", () => {
    expect(STICKER_HOVER).toMatchObject({ ms: 220, lift: -3, scale: 0.03 });
    expect(STICKER_SETTLE).toMatchObject({ stiffness: 300, damping: 22 });
  });

  it("lifts with a bounce and lands exactly at one after 220 ms", () => {
    expect(hoverHand(0)).toBe(0);
    expect(hoverHand(STICKER_HOVER.ms)).toBe(1);
    const middle = hoverHand(STICKER_HOVER.ms / 2);
    expect(middle).toBeGreaterThan(1);
    // Monotone after the overshoot: the sheet does not wobble on the way up.
    const tail = [0.6, 0.7, 0.8, 0.9, 1].map((f) => hoverHand(STICKER_HOVER.ms * f));
    expect(tail).toEqual([...tail].sort((a, b) => b - a));
  });

  it("settles from the hand to rest with one small overshoot", () => {
    expect(settleHand(0)).toBe(1);
    const values = Array.from({ length: 61 }, (_, i) => settleHand(i * 10));
    expect(Math.min(...values)).toBeLessThan(0);
    expect(Math.abs(settleHand(STICKER_SETTLE.ms))).toBeLessThan(0.01);
    expect(Math.abs(settleHand(1_500))).toBeLessThan(0.001);
  });

  it("grows the shadow under the hand and a third more while carried", () => {
    expect(stickerShadow(0)).toBe(1);
    expect(stickerShadow(1)).toBeGreaterThan(1);
    expect(stickerShadow(1, true)).toBeGreaterThan(stickerShadow(1));
    expect(stickerShadow(1, true) / stickerShadow(1)).toBeCloseTo(1.3);
  });
});
