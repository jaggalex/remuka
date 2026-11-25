/**
 * The «Хром» aggregate and its two thresholds (`spec/tidy-desk.md` §9, ADR-294).
 *
 * The counts are hand-written in the comments: the window is 28 days ending on the day,
 * a repeated event of one organisation is one organisation, and the denominator includes
 * every organisation that was present at all.
 */
import { describe, expect, it } from "vitest";
import { CHROME_CONTROLS } from "@remo/metrics";
import {
  CHROME_DEEP_SHARE,
  CHROME_SURFACE_SHARE,
  chromeDim,
  chromeItems,
  chromeVerdict,
} from "./chrome.mjs";
import { computeActiveOrgs28, computeChromeUsage } from "./compute.mjs";

const DAY = "2026-11-23";
const WINDOW_START = "2026-10-27";

const EVENTS = [
  // o1 pressed Export twice inside the window; it is still one organisation.
  { name: "chrome.used", orgId: "o1", occurredAt: `${WINDOW_START}T09:00:00.000Z`, props: { control: "room.export" } },
  { name: "chrome.used", orgId: "o1", occurredAt: "2026-11-20T09:00:00.000Z", props: { control: "room.export" } },
  { name: "chrome.used", orgId: "o2", occurredAt: "2026-11-20T10:00:00.000Z", props: { control: "room.export" } },
  { name: "chrome.used", orgId: "o3", occurredAt: "2026-11-20T11:00:00.000Z", props: { control: "search.open" } },
  // One day before the window: it must not count.
  { name: "chrome.used", orgId: "o4", occurredAt: "2026-10-26T10:00:00.000Z", props: { control: "room.trash" } },
  // Value events: two organisations worked in the window.
  { name: "object.created", orgId: "o1", occurredAt: "2026-11-21T09:00:00.000Z", props: {} },
  { name: "board.saved", orgId: "o2", occurredAt: "2026-11-21T10:00:00.000Z", props: { objectCount: 2 } },
  // A sign-in is presence too, so o3 is in the denominator.
  { name: "session.started", orgId: "o3", occurredAt: "2026-11-21T11:00:00.000Z", props: {} },
  // Outside the window: does not make o5 active.
  { name: "object.created", orgId: "o5", occurredAt: "2026-10-26T10:00:00.000Z", props: {} },
];

function byControl(rows) {
  return new Map(rows.map((row) => [row.dims.control, row.value]));
}
describe("chrome.orgs28", () => {
  it("counts distinct organisations per control over the trailing 28 days", () => {
    const counts = byControl(computeChromeUsage({ day: DAY, events: EVENTS }));
    expect(counts.get(chromeDim("room.export"))).toBe(2); // o1 and o2, two presses of o1 are one
    expect(counts.get(chromeDim("search.open"))).toBe(1); // o3
    expect(counts.get(chromeDim("room.trash"))).toBe(0); // only outside the window
    expect(counts.get(chromeDim("canvas.addCard"))).toBe(0); // a real zero for an unused control
    expect(counts.size).toBe(CHROME_CONTROLS.length);
  });

  it("counts every organisation present in the window, including a sign-in", () => {
    expect(computeActiveOrgs28({ day: DAY, events: EVENTS })).toEqual([
      { metric: "active.orgs28", dims: {}, value: 3, status: "ok", basis: "derived" },
    ]);
  });
});

describe("chrome verdicts", () => {
  it("uses the strict 5 % and 40 % thresholds", () => {
    expect(CHROME_DEEP_SHARE).toBe(5);
    expect(CHROME_SURFACE_SHARE).toBe(40);
    expect(chromeVerdict(4, 100)).toEqual({ share: 4, verdict: "deep" });
    expect(chromeVerdict(5, 100)).toEqual({ share: 5, verdict: null });
    expect(chromeVerdict(40, 100)).toEqual({ share: 40, verdict: null });
    expect(chromeVerdict(41, 100)).toEqual({ share: 41, verdict: "place" });
  });

  it("never suggests surfacing a control that is already in the header", () => {
    expect(chromeVerdict(41, 100, "header")).toEqual({ share: 41, verdict: null });
  });

  it("says nothing when there is no denominator", () => {
    expect(chromeVerdict(0, 0)).toEqual({ share: null, verdict: null });
    expect(chromeVerdict(null, 100)).toEqual({ share: null, verdict: null });
  });
});

describe("chrome table", () => {
  it("shows every control, used first, and keeps a hole a hole", () => {
    const items = chromeItems({
      orgsByControl: new Map([
        ["room.export", 2],
        ["search.open", null],
      ]),
      activeOrgs: 10,
    });
    expect(items).toHaveLength(CHROME_CONTROLS.length);
    expect(items[0]).toMatchObject({ control: "room.export", orgs: 2, share: 20, verdict: null });
    const missing = items.find((item) => item.control === "search.open");
    expect(missing).toMatchObject({ orgs: null, share: null, verdict: null });
    // A control without a row sits below the used ones, not above them as a fake zero.
    expect(items.at(-1)?.orgs).toBeNull();
  });
});
