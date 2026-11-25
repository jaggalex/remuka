import { describe, expect, it } from "vitest";
import {
  CHROME_CONTROLS,
  createRecorder,
  METRIC_CATALOG,
  METRIC_NAMES,
  metricEvent,
} from "@remo/metrics";

describe("product metrics (ADR-082)", () => {
  it("keeps the name list and the catalog in sync", () => {
    expect([...METRIC_NAMES].sort()).toEqual(Object.keys(METRIC_CATALOG).sort());
  });

  it("builds a content-free envelope", () => {
    const event = metricEvent({
      name: "board.created",
      orgId: "org-1",
      actorId: "user-1",
      boardId: "board-1",
      props: { teamId: "team-1" },
    });
    expect(event).toMatchObject({
      name: "board.created",
      org_id: "org-1",
      actor_id: "user-1",
      actor_type: "user",
      board_id: "board-1",
      schema_version: 1,
    });
    expect(event.event_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("is a no-op without a sink and never throws", () => {
    const recorder = createRecorder();
    expect(recorder.enabled).toBe(false);
    expect(() => recorder.emit(metricEvent({ name: "board.saved", orgId: "o", props: { objectCount: 0 } }))).not.toThrow();
  });

  it("delivers to an enabled sink only", () => {
    const events = [];
    const recorder = createRecorder({ enabled: true, sink: (event) => events.push(event) });
    recorder.emit(metricEvent({ name: "help.opened", orgId: "org" }));
    expect(events).toHaveLength(1);
  });

  it("rejects unknown event names and missing required props", () => {
    expect(() => metricEvent({ name: "board.opened" })).toThrow(/unknown metric/);
    expect(() => metricEvent({ name: "board.saved", orgId: "o" })).toThrow(/needs prop objectCount/);
    expect(() => metricEvent({ name: "help.search", orgId: "o", props: { query: "secret", lang: "ru", queryLength: 6, resultCount: 0 } })).toThrow(/content or personal data/);
  });

  it("accepts a chrome control from the closed list and refuses anything else", () => {
    expect(() =>
      metricEvent({ name: "chrome.used", orgId: "o", props: { control: "room.export" } }),
    ).not.toThrow();
    expect(() =>
      metricEvent({ name: "chrome.used", orgId: "o", props: { control: "not.a.control" } }),
    ).toThrow(/unknown control/);
    // A room or a person may not ride along in the only event about placement.
    expect(() =>
      metricEvent({
        name: "chrome.used",
        orgId: "o",
        props: { control: "room.export", roomId: "r-1" },
      }),
    ).toThrow(/only the control property/);
  });

  it("keeps people and room ids out of the catalog and the control list", () => {
    const forbidden = ["orgId", "actorId", "userId", "boardId", "roomId", "sessionId", "personId", "memberId"];
    for (const [name, definition] of Object.entries(METRIC_CATALOG)) {
      const props = [...definition.required, ...definition.optional];
      for (const key of forbidden) {
        expect(props, `${name}.${key}`).not.toContain(key);
      }
    }
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    for (const control of CHROME_CONTROLS) {
      // A control is a registry id, never an identifier of a person or a room.
      expect(control.id, control.id).not.toMatch(uuid);
      expect(control.id, control.id).not.toMatch(/(^|[._])(user|person|room|board|org)[._]?id/i);
    }
  });
});
