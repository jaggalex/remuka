import { describe, expect, it, vi } from "vitest";
import { MOVED_BANNER_MS, followMoved, movedUrl } from "./moved";

describe("moving an open tab to the new address (ADR-254 §6)", () => {
  it("keeps the page's path, query and fragment on the new origin", () => {
    expect(
      movedUrl("https://app.remuka.com", {
        pathname: "/",
        search: "?room=board-main&x=1",
        hash: "#note",
      }),
    ).toBe("https://app.remuka.com/?room=board-main&x=1#note");
    // A path inside the target is not this page's path; the page's own wins.
    expect(
      movedUrl("https://app.remuka.com/ignored", { pathname: "/room", search: "?room=r1" }),
    ).toBe("https://app.remuka.com/room?room=r1");
  });

  it("refuses a target that is not an http(s) origin", () => {
    expect(movedUrl("not a url", { pathname: "/", search: "" })).toBeNull();
    expect(movedUrl("javascript:alert(1)", { pathname: "/", search: "" })).toBeNull();
  });

  it("shows the banner first and then reloads the same page", () => {
    const replace = vi.fn();
    const schedule = vi.fn((run: () => void) => run());
    const target = followMoved("https://app.remuka.com", {
      location: { pathname: "/", search: "?room=abc" },
      replace,
      schedule,
    });

    expect(target).toBe("https://app.remuka.com/?room=abc");
    // Long enough to be read; the notice itself lasts four seconds.
    expect(schedule).toHaveBeenCalledWith(expect.any(Function), MOVED_BANNER_MS);
    expect(replace).toHaveBeenCalledWith("https://app.remuka.com/?room=abc");
  });

  it("stays put when the reason named no usable target", () => {
    const replace = vi.fn();
    const schedule = vi.fn();
    expect(followMoved(null, { replace, schedule })).toBeNull();
    expect(followMoved("javascript:alert(1)", { replace, schedule })).toBeNull();
    expect(schedule).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });
});
