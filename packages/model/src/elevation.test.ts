import { describe, expect, it } from "vitest";
import { canElevate, ELEVATIONS, elevationOf } from "./elevation";

describe("elevation (ADR-245)", () => {
  it("lets only a kanban, a frame and a shape stand off the board", () => {
    expect(["kanban", "frame", "shape"].every((type) => canElevate({ type: type as never }))).toBe(true);
    expect(canElevate({ type: "sticky_note" })).toBe(false);
    expect(canElevate({ type: "card" })).toBe(false);
    expect(canElevate({ type: "connector" })).toBe(false);
  });

  it("reads an absent or foreign level as flat (ADR-245)", () => {
    expect(elevationOf({ type: "frame" })).toBeNull();
    expect(elevationOf({ type: "frame", style: { elevation: "raised" } })).toBe("raised");
    expect(elevationOf({ type: "card", style: { elevation: "raised" } })).toBeNull();
    expect(elevationOf({ type: "shape", style: { elevation: "x" as never } })).toBeNull();
  });

  it("offers cardboard as the third level (ADR-267)", () => {
    expect(ELEVATIONS).toEqual(["raised", "cardboard", "floating"]);
    for (const type of ["kanban", "frame", "shape"] as const) {
      expect(elevationOf({ type, style: { elevation: "cardboard" } })).toBe("cardboard");
    }
    // A level this build does not know still reads as flat, not as the nearest guess.
    expect(elevationOf({ type: "shape", style: { elevation: "hovering" as never } })).toBeNull();
  });
});
