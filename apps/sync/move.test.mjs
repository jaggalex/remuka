import { describe, expect, it, vi } from "vitest";
import { moveDay, moveOrigin, resolveMove, warnMove } from "./move.mjs";

describe("the planned move (spec/rebrand-fixes.md §1)", () => {
  it("reads an absolute https origin and a real calendar day", () => {
    expect(moveOrigin("https://app.remuka.com")).toBe("https://app.remuka.com");
    expect(moveOrigin(" https://app.remuka.com/ ")).toBe("https://app.remuka.com");
    expect(moveDay("2026-12-01")).toBe("2026-12-01");
  });

  it("refuses an address that is not a bare https origin", () => {
    for (const value of [
      "http://app.remuka.com",
      "app.remuka.com",
      "https://app.remuka.com/help",
      "https://app.remuka.com?x=1",
      "https://app.remuka.com#top",
      "https://user:pass@app.remuka.com",
      "javascript:alert(1)",
      "",
    ]) {
      expect(moveOrigin(value), value).toBeNull();
    }
  });

  it("refuses a malformed or impossible date", () => {
    for (const value of ["2026-02-30", "2026-13-01", "01.12.2026", "2026-1-1", ""]) {
      expect(moveDay(value), value).toBeNull();
    }
  });

  it("returns the pair only when both variables are valid", () => {
    const both = { REMO_APP_MOVE_TO: "https://app.remuka.com", REMO_APP_MOVE_AT: "2026-12-01" };
    expect(resolveMove(both)).toEqual({ to: "https://app.remuka.com", at: "2026-12-01" });
    expect(resolveMove({})).toBeNull();
    expect(resolveMove({ REMO_APP_MOVE_TO: "https://app.remuka.com" })).toBeNull();
    expect(resolveMove({ REMO_APP_MOVE_AT: "2026-12-01" })).toBeNull();
    expect(
      resolveMove({ REMO_APP_MOVE_TO: "https://app.remuka.com", REMO_APP_MOVE_AT: "2026-02-30" }),
    ).toBeNull();
  });

  it("warns once for a half-set or malformed pair, and stays quiet otherwise", () => {
    const log = vi.fn();
    warnMove({}, log);
    warnMove({ REMO_APP_MOVE_TO: "https://app.remuka.com", REMO_APP_MOVE_AT: "2026-12-01" }, log);
    expect(log).not.toHaveBeenCalled();

    warnMove({ REMO_APP_MOVE_TO: "https://app.remuka.com" }, log);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toContain("REMO_APP_MOVE_AT");

    warnMove({ REMO_APP_MOVE_AT: "next week" }, log);
    expect(log).toHaveBeenCalledTimes(2);
  });
});
