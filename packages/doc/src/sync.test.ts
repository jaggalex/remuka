import { describe, expect, it } from "vitest";
import { CLOSE_MOVED, CLOSE_RATE_LIMITED, CLOSE_ROOM_FULL, limitBackoffMs, movedTarget } from "./sync";

describe("reconnect after a write budget close (ADR-173)", () => {
  it("waits, doubles and stops at a cap", () => {
    expect(limitBackoffMs(CLOSE_RATE_LIMITED, 0)).toBe(5_000);
    expect(limitBackoffMs(CLOSE_RATE_LIMITED, 1)).toBe(10_000);
    expect(limitBackoffMs(CLOSE_RATE_LIMITED, 10)).toBe(60_000);
  });

  it("waits longer for a full room, where space returns only after a deletion", () => {
    expect(limitBackoffMs(CLOSE_ROOM_FULL, 0)).toBe(30_000);
    expect(limitBackoffMs(CLOSE_ROOM_FULL, 10)).toBe(300_000);
  });

  it("uses the server's close codes", () => {
    expect([CLOSE_RATE_LIMITED, CLOSE_ROOM_FULL]).toEqual([4429, 4413]);
  });
});

describe("a retired address (ADR-254 §6)", () => {
  it("uses 4001 and reads the origin out of the reason", () => {
    expect(CLOSE_MOVED).toBe(4001);
    expect(movedTarget("moved:https://app.remuka.com")).toBe("https://app.remuka.com");
    expect(movedTarget("moved:https://app.remuka.com/")).toBe("https://app.remuka.com");
  });

  it("refuses to invent a target from a broken or hostile reason", () => {
    expect(movedTarget("")).toBeNull();
    expect(movedTarget(undefined)).toBeNull();
    expect(movedTarget("https://app.remuka.com")).toBeNull();
    expect(movedTarget("moved:javascript:alert(1)")).toBeNull();
    expect(movedTarget("moved:not a url")).toBeNull();
  });
});
