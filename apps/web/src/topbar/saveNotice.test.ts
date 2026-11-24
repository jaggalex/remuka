import { describe, expect, it } from "vitest";
import {
  SAVE_DONE_FOR_MS,
  SAVE_SLOW_AFTER_MS,
  saveNoticeKind,
} from "./saveNotice";

/**
 * The header's save table (ADR-266 §3). The timing is the behaviour: an ordinary ack
 * must never flash a word, and a return from offline must be readable.
 */
describe("the save notice", () => {
  const base = { blocked: false, pendingMs: null, savedMs: null } as const;

  it("says nothing while saved or during a short wait", () => {
    expect(saveNoticeKind({ ...base, state: "saved" })).toBe("none");
    expect(saveNoticeKind({ ...base, state: "pending", pendingMs: 0 })).toBe("none");
    expect(
      saveNoticeKind({ ...base, state: "pending", pendingMs: SAVE_SLOW_AFTER_MS - 1 }),
    ).toBe("none");
  });

  it("names a long wait, but not before two seconds", () => {
    expect(
      saveNoticeKind({ ...base, state: "pending", pendingMs: SAVE_SLOW_AFTER_MS }),
    ).toBe("saving");
    expect(saveNoticeKind({ ...base, state: "connecting", pendingMs: 5_000 })).toBe(
      "saving",
    );
  });

  it("shows offline and stopped input at once", () => {
    expect(saveNoticeKind({ ...base, state: "offline" })).toBe("offline");
    expect(
      saveNoticeKind({ ...base, state: "offline", blocked: true }),
    ).toBe("blocked");
  });

  it("keeps “All saved” for two seconds after offline and then hides it", () => {
    expect(saveNoticeKind({ ...base, state: "saved", savedMs: 0 })).toBe("saved");
    expect(
      saveNoticeKind({ ...base, state: "saved", savedMs: SAVE_DONE_FOR_MS - 1 }),
    ).toBe("saved");
    expect(
      saveNoticeKind({ ...base, state: "saved", savedMs: SAVE_DONE_FOR_MS }),
    ).toBe("none");
  });
});
