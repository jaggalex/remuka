import { describe, expect, it } from "vitest";
import {
  CURSOR_BUFFER_MS,
  CURSOR_IDLE_ALPHA,
  CURSOR_IDLE_DIM_MS,
  CURSOR_IDLE_HIDE_MS,
  CURSOR_SPRING,
  CursorMotion,
} from "./cursorMotion";

const OPTS = { zoom: 1, teleport: 3000, reduced: false };
const peer = (x: number, y: number) => ({ sessionKey: "ilya", self: false, cursor: { x, y } });

/** Run the motion at 60 fps from `from` to `to` ms, returning the x track. */
function run(motion: CursorMotion, from: number, to: number) {
  const xs: number[] = [];
  for (let t = from; t <= to; t += 1000 / 60) {
    motion.step(t, OPTS);
    xs.push(motion.view("ilya", t)!.x);
  }
  return xs;
}

describe("cursor motion (ADR-265)", () => {
  it("uses the spring the owner approved", () => {
    expect(CURSOR_SPRING).toEqual({ stiffness: 125, damping: 23 });
  });

  it("eases towards a 300 px jump without overshooting by a pixel", () => {
    const motion = new CursorMotion();
    motion.ingest([peer(0, 0)], 0);
    run(motion, 0, 200);
    motion.ingest([peer(300, 0)], 200);
    const xs = run(motion, 200, 3200);
    expect(Math.max(...xs)).toBeLessThan(301);
    // It starts slowly (the buffer and the spring), then arrives.
    expect(xs[3]!).toBeLessThan(30);
    expect(xs[xs.length - 1]).toBe(300);
  });

  it("aims at the position the peer had a buffer ago, between samples", () => {
    const motion = new CursorMotion();
    motion.ingest([peer(0, 0)], 0);
    motion.ingest([peer(100, 0)], 100);
    motion.ingest([peer(200, 0)], 200);
    // At 200 ms the target is the 100 ms sample, not the newest one.
    motion.step(199, OPTS);
    const before = motion.view("ilya", 199)!.x;
    expect(before).toBeLessThan(100 + 1);
    expect(CURSOR_BUFFER_MS).toBe(100);
  });

  it("teleports across a long jump instead of flying over the board", () => {
    const motion = new CursorMotion();
    motion.ingest([peer(0, 0)], 0);
    motion.step(0, OPTS);
    motion.ingest([peer(10_000, 0)], 16);
    motion.step(16 + CURSOR_BUFFER_MS + 1, OPTS);
    expect(motion.view("ilya", 117)!.x).toBe(10_000);
  });

  it("dims a still cursor after 10 s and hides it after 60 s", () => {
    const motion = new CursorMotion();
    motion.ingest([peer(5, 5)], 0);
    const r = motion.step(1000, OPTS);
    expect(r.wakeIn).toBe(CURSOR_IDLE_DIM_MS - 1000);
    expect(motion.view("ilya", 1000)!.alpha).toBe(1);
    expect(motion.view("ilya", CURSOR_IDLE_DIM_MS)!.alpha).toBe(CURSOR_IDLE_ALPHA);
    expect(motion.view("ilya", CURSOR_IDLE_HIDE_MS)!.alpha).toBe(0);
  });

  it("snaps without a spring under reduced motion", () => {
    const motion = new CursorMotion();
    motion.ingest([peer(0, 0)], 0);
    motion.ingest([peer(300, 40)], 50);
    const r = motion.step(51, { ...OPTS, reduced: true });
    expect(motion.view("ilya", 51, true)).toEqual({ x: 300, y: 40, alpha: 1 });
    expect(r.moving).toBe(false);
  });

  it("forgets a peer who left and ignores the local session", () => {
    const motion = new CursorMotion();
    motion.ingest([peer(1, 1), { sessionKey: "me", self: true, cursor: { x: 0, y: 0 } }], 0);
    expect(motion.view("me", 0)).toBeNull();
    motion.ingest([], 10);
    expect(motion.view("ilya", 10)).toBeNull();
  });
});
