/**
 * One function per metric (`spec/pulse.md` §4.3).
 *
 * Each function is pure: it receives the rows a day, week or month needs and returns the
 * `metrics_daily` rows for that period. The aggregator loads the rows; this file owns the
 * formula, so the panel, the digest and any future BI cannot disagree (rule 1). A test
 * beside this file pins a pre-computed answer for every catalogue entry.
 *
 * Unique people and organisations are never added from daily rows (§4.3): a week is
 * counted from the events of that week, a month from the events of that month.
 */
import { addDays, startOfWeek } from "./time.mjs";
import { normalizeDim, normalizeDims } from "./catalog.mjs";
import { CHROME_CONTROLS } from "@remo/metrics";
import { CHROME_WINDOW_DAYS, chromeDim } from "./chrome.mjs";

/** A value event (`spec/metrics.md`): proof that work, not a sign-in, happened. */
const VALUE_EVENTS = new Set([
  "board.saved",
  "object.created",
  "connector.created",
  "agent.task.finished",
]);

/** A save counts only when it changed something (`spec/pulse.md` §1.1). */
function isValueEvent(event) {
  if (!VALUE_EVENTS.has(event.name)) return false;
  if (event.name === "board.saved") return Number(event.props?.objectCount ?? 0) > 0;
  if (event.name === "agent.task.finished") return event.props?.status === "applied";
  return true;
}

/** A person, not an agent or a link visitor (`spec/metrics.md`, MAU/DAU). */
function isPerson(event) {
  return event.actorType === "user" && Boolean(event.actorId);
}

function occurredBetween(event, from, to) {
  const at = event.occurredAt instanceof Date ? event.occurredAt : new Date(event.occurredAt);
  const moment = at.getTime();
  return moment >= from && moment < to;
}

function dayBounds(day) {
  const from = new Date(`${day}T00:00:00.000Z`).getTime();
  return [from, from + 24 * 60 * 60 * 1000];
}

function periodBounds(from, to) {
  return [new Date(`${from}T00:00:00.000Z`).getTime(), new Date(`${addDays(to, 1)}T00:00:00.000Z`).getTime()];
}

/** The trailing window ending on `day`, as `[start, end)` moments. */
function trailingBounds(day, days) {
  return periodBounds(addDays(day, -(days - 1)), day);
}

function row(metric, dims, value, { status = "ok", basis = "derived" } = {}) {
  return {
    metric,
    dims: normalizeDims(dims),
    value: status === "ok" ? value : null,
    status,
    basis,
  };
}

/** A subscription normalised to one month, in minor units (`spec/pulse.md` §1.3). */
export function monthlyAmount(subscription) {
  const amount = Number(subscription?.amount ?? 0);
  if (!Number.isFinite(amount)) return 0;
  return subscription.interval === "year" ? Math.round(amount / 12) : Math.round(amount);
}

/** Count a set of organisations grouped by one dimension. */
function countByOrg(events, keyOf) {
  const out = new Map();
  for (const event of events) {
    if (!event.orgId) continue;
    for (const key of keyOf(event)) {
      if (!out.has(key)) out.set(key, new Set());
      out.get(key).add(event.orgId);
    }
  }
  return out;
}

/* -------------------------------------------------------------- acquisition -- */

/** `orgs.created`: organisations created in the day, split by first-touch source (§3). */
export function computeOrgsCreated({ day, orgs = [] }) {
  const [from, to] = dayBounds(day);
  const created = orgs.filter((org) => {
    const at = org.createdAt instanceof Date ? org.createdAt : new Date(org.createdAt);
    return at.getTime() >= from && at.getTime() < to;
  });
  if (created.length === 0) return [row("orgs.created", {}, 0)];
  // A split is a property of the data, not of one day: a day with one sourceless
  // organisation still belongs to the same `source` dimension as its neighbours.
  const split = orgs.some((org) => org.source != null);
  if (!split) return [row("orgs.created", {}, created.length)];
  const counts = new Map();
  for (const org of created) {
    const source = normalizeDim(org.source ?? "direct");
    counts.set(source, (counts.get(source) ?? 0) + 1);
  }
  return [...counts.entries()].map(([source, count]) =>
    row("orgs.created", { source }, count),
  );
}

/** `invites.sent`: invitations created in the day, from the product's own rows. */
export function computeInvitesSent({ day, invitations = [] }) {
  const [from, to] = dayBounds(day);
  const count = invitations.filter((invite) => {
    const at = invite.createdAt instanceof Date ? invite.createdAt : new Date(invite.createdAt);
    return at.getTime() >= from && at.getTime() < to;
  }).length;
  return [row("invites.sent", {}, count)];
}

/** `invites.accepted`: invitations accepted in the day, from the product's own rows. */
export function computeInvitesAccepted({ day, invitations = [] }) {
  const [from, to] = dayBounds(day);
  const count = invitations.filter((invite) => {
    if (!invite.acceptedAt) return false;
    const at = invite.acceptedAt instanceof Date ? invite.acceptedAt : new Date(invite.acceptedAt);
    return at.getTime() >= from && at.getTime() < to;
  }).length;
  return [row("invites.accepted", {}, count)];
}

/* ------------------------------------------------------------- engagement -- */

/**
 * `active.actors`: distinct people with a value event in the day, week or month.
 *
 * `day` is the last day of the period; the caller passes the events of the whole period.
 * A zero is a real zero: the event stream exists and nobody worked.
 */
export function computeActiveActors({ day, events = [], period = null }) {
  const from = period === "week" ? startOfWeek(day) : rowStart(day, period);
  const [start, end] = periodBounds(from, day);
  const people = new Set();
  for (const event of events) {
    if (!isPerson(event) || !isValueEvent(event)) continue;
    if (occurredBetween(event, start, end)) people.add(event.actorId);
  }
  return [row("active.actors", period ? { period } : {}, people.size)];
}

function rowStart(day, period) {
  return period === "month" ? `${String(day).slice(0, 7)}-01` : day;
}

/**
 * `collab.teams`: organisations with at least two people doing a value event in the week.
 *
 * This is the north-star WACT metric (`spec/pulse.md` §1.1). An agent principal is not a
 * person, so its applied task does not make a solo workspace collaborative.
 */
export function computeCollaborativeTeams({ day, events = [] }) {
  const from = startOfWeek(day);
  const [start, end] = periodBounds(from, day);
  const actorsByOrg = new Map();
  for (const event of events) {
    if (!isPerson(event) || !isValueEvent(event)) continue;
    if (!occurredBetween(event, start, end) || !event.orgId) continue;
    if (!actorsByOrg.has(event.orgId)) actorsByOrg.set(event.orgId, new Set());
    actorsByOrg.get(event.orgId).add(event.actorId);
  }
  const teams = [...actorsByOrg.values()].filter((actors) => actors.size >= 2).length;
  return [row("collab.teams", { period: "week" }, teams)];
}

/** `collab.sessions`: rooms where two people edited together, counted once per event. */
export function computeCollaborativeSessions({ day, events = [] }) {
  const [from, to] = dayBounds(day);
  const count = events.filter(
    (event) =>
      event.name === "collab.session" &&
      occurredBetween(event, from, to) &&
      Number(event.props?.participants ?? 0) >= 2,
  ).length;
  return [row("collab.sessions", {}, count)];
}

/** `feature.used`: organisations that used a feature in the week (`spec/pulse.md` §1.2). */
export function computeFeatureUsage({ day, events = [] }) {
  const from = startOfWeek(day);
  const [start, end] = periodBounds(from, day);
  const used = countByOrg(
    events.filter(
      (event) =>
        event.name === "feature.used" && occurredBetween(event, start, end),
    ),
    (event) => [normalizeDim(event.props?.feature ?? "other")],
  );
  return [...used.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([feature, orgs]) => row("feature.used", { period: "week", feature }, orgs.size));
}

/** `template.used`: rooms created from a template, by template (`spec/pulse.md` §1.2). */
export function computeTemplateUsage({ day, events = [] }) {
  const from = startOfWeek(day);
  const [start, end] = periodBounds(from, day);
  const counts = new Map();
  for (const event of events) {
    if (event.name !== "template.used" || !occurredBetween(event, start, end)) continue;
    const template = normalizeDim(event.props?.templateId ?? "other");
    counts.set(template, (counts.get(template) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([template, count]) => row("template.used", { period: "week", template }, count));
}

/* ------------------------------------------------------------------- chrome -- */

/**
 * `chrome.orgs28`: organisations that ran each control in the trailing 28 days
 * (`spec/tidy-desk.md` §9, ADR-294).
 *
 * The event is written once per organisation per day, but the share is over 28 days, so
 * the row is a distinct-organisation count over the whole window and not a sum of daily
 * rows. Every control in the closed list gets a row: a row of zero is a real zero and
 * lets the panel say "nobody used this" instead of "no data".
 */
export function computeChromeUsage({ day, events = [] }) {
  const [start, end] = trailingBounds(day, CHROME_WINDOW_DAYS);
  const used = countByOrg(
    events.filter((event) => event.name === "chrome.used" && occurredBetween(event, start, end)),
    (event) => [chromeDim(String(event.props?.control ?? ""))],
  );
  return CHROME_CONTROLS.map((control) =>
    row("chrome.orgs28", { control: control.id }, used.get(chromeDim(control.id))?.size ?? 0),
  );
}

/**
 * `active.orgs28`: organisations with any event in the trailing 28 days — the
 * denominator of the chrome share. Presence is enough here: an organisation that opened
 * the account menu on its first visit is active even if it has not saved a room yet, and
 * the numerator must never exceed its denominator.
 */
export function computeActiveOrgs28({ day, events = [] }) {
  const [start, end] = trailingBounds(day, CHROME_WINDOW_DAYS);
  const orgs = new Set();
  for (const event of events) {
    if (!event.orgId || !occurredBetween(event, start, end)) continue;
    orgs.add(event.orgId);
  }
  return [row("active.orgs28", {}, orgs.size)];
}

/* -------------------------------------------------------------- activation -- */

/**
 * `activation.cohort` / `activation.reached`: the organisations created in the week and,
 * of them, those that reached the first value within seven days (§1.2, `spec/metrics.md`).
 *
 * An empty cohort is `unavailable`, not zero: a share of nothing cannot be counted (§4.1).
 */
export function computeActivation({ day, orgs = [], events = [] }) {
  const from = startOfWeek(day);
  const [start, end] = periodBounds(from, day);
  const cohort = orgs.filter((org) => {
    const at = org.createdAt instanceof Date ? org.createdAt : new Date(org.createdAt);
    return at.getTime() >= start && at.getTime() < end;
  });
  if (cohort.length === 0) {
    return [
      row("activation.cohort", { period: "week" }, null, { status: "unavailable" }),
      row("activation.reached", { period: "week" }, null, { status: "unavailable" }),
    ];
  }
  const reachedAt = new Map();
  for (const event of events) {
    if (event.name !== "activation.first_value" || !event.orgId) continue;
    const at = new Date(event.occurredAt).getTime();
    if (!reachedAt.has(event.orgId) || at < reachedAt.get(event.orgId)) {
      reachedAt.set(event.orgId, at);
    }
  }
  const activated = cohort.filter((org) => {
    const moment = reachedAt.get(org.id);
    if (moment === undefined) return false;
    const created = new Date(org.createdAt).getTime();
    return moment - created <= 7 * 24 * 60 * 60 * 1000;
  }).length;
  return [
    row("activation.cohort", { period: "week" }, cohort.length),
    row("activation.reached", { period: "week" }, activated),
  ];
}

/* --------------------------------------------------------------- retention -- */

/**
 * `retention.cohort` / `retention.active`: for every observation week, the cohorts created
 * 0–12 weeks before it and how many of their organisations worked that week (§1.2).
 *
 * Rows sit on the week's last day with `dims.cohort` and `dims.offset`; the denominator is
 * written next to the numerator so a share is computed on read (§4.1). A cohort that
 * nobody joined has no row, and the heat map shows "—".
 */
export function computeRetention({ day, orgs = [], events = [], offsets = 12 }) {
  const [start, end] = periodBounds(startOfWeek(day), day);
  const activeOrgs = new Set();
  for (const event of events) {
    if (!event.orgId || !isValueEvent(event)) continue;
    if (occurredBetween(event, start, end)) activeOrgs.add(event.orgId);
  }
  const rows = [];
  for (let offset = 0; offset <= offsets; offset += 1) {
    const cohortEnd = addDays(day, -7 * offset);
    const cohortStart = startOfWeek(cohortEnd);
    const [from, to] = periodBounds(cohortStart, cohortEnd);
    const cohort = new Set();
    for (const org of orgs) {
      const at = org.createdAt instanceof Date ? org.createdAt : new Date(org.createdAt);
      if (at.getTime() >= from && at.getTime() < to) cohort.add(org.id);
    }
    if (cohort.size === 0) continue;
    const active = [...cohort].filter((orgId) => activeOrgs.has(orgId)).length;
    const dims = { period: "week", cohort: cohortStart, offset };
    rows.push(row("retention.cohort", dims, cohort.size));
    rows.push(row("retention.active", dims, active));
  }
  return rows;
}

/* ------------------------------------------------------------------- money -- */

/**
 * `money.mrr` and `money.paying`: a snapshot of the billing tables at the end of `day`.
 *
 * It is a snapshot, not a derivation (§4.3): the state of a subscription in the past
 * cannot be recovered from today's rows, so the writer inserts once and the history is
 * never rewritten. A day first counted late carries `basis = 'rebuilt'`, which the panel
 * marks as an estimate.
 */
export function computeMoney({ day, subscriptions = null, basis = "snapshot" }) {
  // No source is a hole, not a row: a snapshot is written once, so an `unavailable` row
  // would hide the day forever. A later run inserts the state it sees and marks it
  // `rebuilt` (§4.3).
  if (subscriptions === null) return [];
  const live = subscriptions.filter(
    (subscription) =>
      ["active", "past_due"].includes(subscription.status) &&
      subscription.plan !== "free" &&
      Number(subscription.amount) >= 0,
  );
  const byCurrencyPlan = new Map();
  for (const subscription of live) {
    const key = `${subscription.currency}\u0000${subscription.plan}`;
    byCurrencyPlan.set(key, (byCurrencyPlan.get(key) ?? 0) + monthlyAmount(subscription));
  }
  const mrr =
    byCurrencyPlan.size === 0
      ? [row("money.mrr", {}, 0, { basis })]
      : [...byCurrencyPlan.entries()]
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, amount]) => {
            const [currency, plan] = key.split("\u0000");
            return row("money.mrr", { currency, plan }, amount, { basis });
          });
  const paying = new Set(live.map((subscription) => subscription.orgId)).size;
  return [...mrr, row("money.paying", {}, paying, { basis })];
}
