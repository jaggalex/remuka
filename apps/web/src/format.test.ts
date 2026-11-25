import { describe, expect, it } from "vitest";
import { formatAgo } from "./format";

/**
 * The home tile's "changed 2 minutes ago" (ADR-265 §2, rule 3).
 *
 * The clock is an argument, so the thresholds are proved without waiting: minutes, hours,
 * days, and the moment the relative form becomes less useful than a calendar date.
 */
describe("formatAgo", () => {
  const now = new Date("2026-11-24T12:00:00Z").getTime();
  const at = (iso: string) => formatAgo(iso, "en", now);
  const ru = (iso: string) => formatAgo(iso, "ru", now);

  it("speaks minutes and hours", () => {
    expect(at("2026-11-24T11:58:00Z")).toBe("2 minutes ago");
    expect(at("2026-11-24T09:00:00Z")).toBe("3 hours ago");
  });

  it("uses yesterday and weekday forms for the last week", () => {
    expect(at("2026-11-23T12:00:00Z")).toBe("yesterday");
    expect(ru("2026-11-23T12:00:00Z")).toBe("вчера");
  });

  it("falls back to the calendar date beyond a week", () => {
    expect(at("2026-11-10T12:00:00Z")).toBe("10 Nov 2026");
    expect(ru("2026-11-10T12:00:00Z")).toBe("10 нояб. 2026 г.");
  });

  it("keeps an unreadable value readable", () => {
    expect(at("not a date")).toBe("not a date");
  });
});
