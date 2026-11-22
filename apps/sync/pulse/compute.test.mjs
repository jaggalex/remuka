/**
 * Fixture answers for every metric formula (`spec/pulse.md` §4.3, §9).
 *
 * The rows are hand-counted in the comments; if a formula changes, a number here changes
 * and the diff says which definition moved.
 */
import { describe, expect, it } from "vitest";
import {
  computeActivation,
  computeActiveActors,
  computeCollaborativeSessions,
  computeCollaborativeTeams,
  computeFeatureUsage,
  computeInvitesAccepted,
  computeInvitesSent,
  computeMoney,
  computeOrgsCreated,
  computeRetention,
  computeTemplateUsage,
} from "./compute.mjs";
import { metricsFor, metricAvailable, normalizeDims, suppressesSmallCell } from "./catalog.mjs";

const ORGS = [
  { id: "o1", createdAt: "2026-11-16T09:00:00.000Z", source: "habr" },
  { id: "o2", createdAt: "2026-11-17T10:00:00.000Z", source: "Habr" },
  { id: "o3", createdAt: "2026-11-18T11:00:00.000Z", source: null },
  { id: "o4", createdAt: "2026-08-24T08:00:00.000Z", source: "t.me" },
];

const EVENTS = [
  { name: "board.saved", actorType: "user", actorId: "u1", orgId: "o1", occurredAt: "2026-11-16T09:30:00.000Z", props: { objectCount: 3 } },
  { name: "object.created", actorType: "user", actorId: "u2", orgId: "o1", occurredAt: "2026-11-17T12:00:00.000Z", props: {} },
  { name: "object.created", actorType: "user", actorId: "u1", orgId: "o2", occurredAt: "2026-11-18T09:00:00.000Z", props: {} },
  // A save without changes is not a value event.
  { name: "board.saved", actorType: "user", actorId: "u3", orgId: "o2", occurredAt: "2026-11-18T10:00:00.000Z", props: { objectCount: 0 } },
  // An agent is not a person, so its applied task does not make a team collaborative.
  { name: "agent.task.finished", actorType: "agent", actorId: "a1", orgId: "o2", occurredAt: "2026-11-18T11:00:00.000Z", props: { status: "applied" } },
  // A sign-in is not activity.
  { name: "session.started", actorType: "user", actorId: "u9", orgId: "o3", occurredAt: "2026-11-18T12:00:00.000Z", props: {} },
  { name: "activation.first_value", actorType: "user", actorId: "u1", orgId: "o1", occurredAt: "2026-11-18T13:00:00.000Z", props: { kind: "solo" } },
  { name: "collab.session", actorType: "user", actorId: "u1", orgId: "o1", occurredAt: "2026-11-18T14:00:00.000Z", props: { participants: 2, durationMin: 20 } },
  { name: "feature.used", actorType: "user", actorId: "u1", orgId: "o1", occurredAt: "2026-11-19T09:00:00.000Z", props: { feature: "kanban" } },
  { name: "template.used", actorType: "user", actorId: "u1", orgId: "o1", occurredAt: "2026-11-20T09:00:00.000Z", props: { templateId: "Sprint Plan" } },
];

const INVITES = [
  { createdAt: "2026-11-18T08:00:00.000Z", acceptedAt: "2026-11-19T08:00:00.000Z" },
  { createdAt: "2026-11-18T09:00:00.000Z", acceptedAt: null },
];

describe("orgs.created", () => {
  it("splits a day by normalised first-touch source", () => {
    expect(computeOrgsCreated({ day: "2026-11-16", orgs: ORGS })).toEqual([
      { metric: "orgs.created", dims: { source: "habr" }, value: 1, status: "ok", basis: "derived" },
    ]);
  });

  it("keeps a sourceless organisation as `direct` when the split exists", () => {
    expect(computeOrgsCreated({ day: "2026-11-18", orgs: ORGS })).toEqual([
      { metric: "orgs.created", dims: { source: "direct" }, value: 1, status: "ok", basis: "derived" },
    ]);
  });

  it("writes a real zero for a day with no organisations", () => {
    expect(computeOrgsCreated({ day: "2026-11-15", orgs: ORGS })).toEqual([
      { metric: "orgs.created", dims: {}, value: 0, status: "ok", basis: "derived" },
    ]);
  });
});

describe("active.actors", () => {
  it("counts people with a value event and excludes agents and sign-ins", () => {
    expect(computeActiveActors({ day: "2026-11-18", events: EVENTS })).toEqual([
      { metric: "active.actors", dims: {}, value: 1, status: "ok", basis: "derived" },
    ]);
  });

  it("counts a week from its events, not from seven daily rows", () => {
    expect(computeActiveActors({ day: "2026-11-22", events: EVENTS, period: "week" })).toEqual([
      { metric: "active.actors", dims: { period: "week" }, value: 2, status: "ok", basis: "derived" },
    ]);
  });

  it("counts a month from its events", () => {
    expect(
      computeActiveActors({ day: "2026-11-30", events: EVENTS, period: "month" }),
    ).toEqual([
      { metric: "active.actors", dims: { period: "month" }, value: 2, status: "ok", basis: "derived" },
    ]);
  });
});

describe("collaboration", () => {
  it("counts an organisation only when two people did a value event", () => {
    expect(computeCollaborativeTeams({ day: "2026-11-22", events: EVENTS })).toEqual([
      { metric: "collab.teams", dims: { period: "week" }, value: 1, status: "ok", basis: "derived" },
    ]);
  });

  it("counts a concurrent session once", () => {
    expect(computeCollaborativeSessions({ day: "2026-11-18", events: EVENTS })).toEqual([
      { metric: "collab.sessions", dims: {}, value: 1, status: "ok", basis: "derived" },
    ]);
  });
});

describe("activation", () => {
  it("counts the week cohort and those reaching value within seven days", () => {
    const rows = computeActivation({ day: "2026-11-22", orgs: ORGS, events: EVENTS });
    expect(rows).toEqual([
      { metric: "activation.cohort", dims: { period: "week" }, value: 3, status: "ok", basis: "derived" },
      { metric: "activation.reached", dims: { period: "week" }, value: 1, status: "ok", basis: "derived" },
    ]);
  });

  it("calls an empty cohort unavailable, not zero", () => {
    expect(computeActivation({ day: "2026-11-22", orgs: [], events: [] })).toEqual([
      { metric: "activation.cohort", dims: { period: "week" }, value: null, status: "unavailable", basis: "derived" },
      { metric: "activation.reached", dims: { period: "week" }, value: null, status: "unavailable", basis: "derived" },
    ]);
  });
});

describe("retention", () => {
  it("counts the observation week for every cohort that exists", () => {
    const rows = computeRetention({ day: "2026-11-22", orgs: ORGS, events: EVENTS });
    expect(rows).toEqual([
      { metric: "retention.cohort", dims: { period: "week", cohort: "2026-11-16", offset: 0 }, value: 3, status: "ok", basis: "derived" },
      { metric: "retention.active", dims: { period: "week", cohort: "2026-11-16", offset: 0 }, value: 2, status: "ok", basis: "derived" },
      { metric: "retention.cohort", dims: { period: "week", cohort: "2026-08-24", offset: 12 }, value: 1, status: "ok", basis: "derived" },
      { metric: "retention.active", dims: { period: "week", cohort: "2026-08-24", offset: 12 }, value: 0, status: "ok", basis: "derived" },
    ]);
  });
});

describe("feature and template use", () => {
  it("counts organisations per feature in the week", () => {
    expect(computeFeatureUsage({ day: "2026-11-22", events: EVENTS })).toEqual([
      { metric: "feature.used", dims: { period: "week", feature: "kanban" }, value: 1, status: "ok", basis: "derived" },
    ]);
  });

  it("counts rooms per template", () => {
    expect(computeTemplateUsage({ day: "2026-11-22", events: EVENTS })).toEqual([
      { metric: "template.used", dims: { period: "week", template: "sprint-plan" }, value: 1, status: "ok", basis: "derived" },
    ]);
  });
});

describe("invitations", () => {
  it("counts created and accepted invitations from the product rows", () => {
    expect(computeInvitesSent({ day: "2026-11-18", invitations: INVITES })).toEqual([
      { metric: "invites.sent", dims: {}, value: 2, status: "ok", basis: "derived" },
    ]);
    expect(computeInvitesAccepted({ day: "2026-11-19", invitations: INVITES })).toEqual([
      { metric: "invites.accepted", dims: {}, value: 1, status: "ok", basis: "derived" },
    ]);
  });
});

describe("money", () => {
  const subscriptions = [
    { orgId: "a", plan: "team", amount: 120000, currency: "USD", interval: "year", status: "active" },
    { orgId: "b", plan: "pro", amount: 5000, currency: "USD", interval: "month", status: "past_due" },
    { orgId: "b", plan: "pro", amount: 5000, currency: "USD", interval: "month", status: "active" },
    { orgId: "c", plan: "free", amount: 0, currency: "USD", interval: "month", status: "active" },
  ];

  it("normalises a year to a month and keeps currencies apart", () => {
    expect(computeMoney({ day: "2026-11-22", subscriptions })).toEqual([
      { metric: "money.mrr", dims: { currency: "USD", plan: "pro" }, value: 10000, status: "ok", basis: "snapshot" },
      { metric: "money.mrr", dims: { currency: "USD", plan: "team" }, value: 10000, status: "ok", basis: "snapshot" },
      { metric: "money.paying", dims: {}, value: 2, status: "ok", basis: "snapshot" },
    ]);
  });

  it("marks a late snapshot as rebuilt", () => {
    const rows = computeMoney({ day: "2026-11-20", subscriptions, basis: "rebuilt" });
    expect(rows.every((row) => row.basis === "rebuilt")).toBe(true);
  });

  it("writes zero when billing is readable and nothing is paid", () => {
    expect(computeMoney({ day: "2026-11-22", subscriptions: [] })).toEqual([
      { metric: "money.mrr", dims: {}, value: 0, status: "ok", basis: "snapshot" },
      { metric: "money.paying", dims: {}, value: 0, status: "ok", basis: "snapshot" },
    ]);
  });

  it("leaves a hole when billing is unreadable, so a later run can fill it", () => {
    expect(computeMoney({ day: "2026-11-22", subscriptions: null })).toEqual([]);
  });
});

describe("catalogue", () => {
  it("has a period list for every metric the recompute writes", () => {
    expect(metricsFor("week").map((entry) => entry.metric)).toContain("collab.teams");
    expect(metricsFor("day").map((entry) => entry.metric)).toContain("orgs.created");
  });

  it("knows which instruments this version has", () => {
    expect(metricAvailable("collab.teams")).toBe(true);
    // Stage 1 adds the event; until then the metric is honestly absent, not zero.
    expect(metricAvailable("collab.sessions")).toBe(false);
  });

  it("drops an unknown dimension instead of storing it", () => {
    expect(normalizeDims({ source: "Habr", org_id: "x", period: "week", offset: 4 })).toEqual({
      source: "habr",
      period: "week",
      offset: 4,
    });
  });

  it("suppresses small source, template, feature and skill cells (§5.1)", () => {
    for (const key of ["source", "template", "feature", "skill"]) {
      expect(suppressesSmallCell({ [key]: "x" }, 4)).toBe(true);
      expect(suppressesSmallCell({ [key]: "x" }, 0)).toBe(true);
      expect(suppressesSmallCell({ [key]: "x" }, 5)).toBe(false);
    }
    expect(suppressesSmallCell({ plan: "team" }, 3)).toBe(false);
    expect(suppressesSmallCell({ source: "x" }, 12)).toBe(false);
  });
});
