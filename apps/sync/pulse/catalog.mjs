/**
 * The one list of Pulse metrics (`spec/pulse.md` §1.2–1.3, §4.3).
 *
 * The catalogue is the contract between the writer (`aggregate.mjs`) and every reader:
 * the metric name, its unit, the dimensions it may carry, its basis and whether the
 * installation has the instrument to measure it at all. A formula lives next to the
 * compute function in `compute.mjs`; this file does not know how a number is made.
 *
 * `available` is not a feature flag. It answers one question: can this version emit the
 * raw fact? `@remo/metrics` refuses an event name it does not know, so a metric whose
 * event is absent from `METRIC_CATALOG` cannot honestly be a zero — this installation
 * never observed it. Such a metric is left out of `metrics_daily` and the reader shows
 * "—" with a reason (`spec/pulse.md` §4.6).
 */
import { METRIC_CATALOG } from "@remo/metrics";

/** The closed dimension list of `metrics_daily` (`spec/pulse.md` §4.1). */
export const DIMS = Object.freeze([
  "period",
  "plan",
  "currency",
  "source",
  "feature",
  "template",
  "skill",
  "cohort",
  "offset",
]);

/**
 * Dimensions whose small cells are suppressed on export (`spec/pulse.md` §5.1).
 *
 * The owner's decision of 2026-11-23 extended the specification's `source`/`template`
 * pair to every externally observable split: `feature` and `skill` describe what a
 * customer does, and a cell of one or two betrays the same thing a template does. The
 * list is a closed constant with a test; a new dimension of that kind is added here, not
 * configured per installation.
 */
export const SUPPRESSED_DIMS = Object.freeze(["source", "template", "feature", "skill"]);

/** Below this a small cell is hidden; five is the specification's number (§5.1). */
export const SUPPRESSION_FLOOR = 5;

/** `period` values, as stored in `dims`. */
export const PERIODS = Object.freeze({ day: null, week: "week", month: "month" });

/**
 * One entry per metric. `dims` lists the dimension keys the metric is allowed to carry;
 * `available` is computed from the catalogue of events or from a product table.
 */
export const METRICS = Object.freeze([
  {
    metric: "orgs.created",
    unit: "count",
    class: "derived",
    dims: ["source"],
    available: true,
    description: "Organisations created in the day, by first-touch source",
  },
  {
    metric: "active.actors",
    unit: "count",
    class: "derived",
    dims: [],
    periods: ["day", "week", "month"],
    available: true,
    description: "Distinct people with any event (DAU, WAU, MAU)",
  },
  {
    metric: "collab.teams",
    unit: "count",
    class: "derived",
    dims: [],
    periods: ["week"],
    available: true,
    description: "Organisations where two or more people did a value event in the week",
  },
  {
    metric: "collab.sessions",
    unit: "count",
    class: "derived",
    dims: [],
    periods: ["day"],
    available: eventPresent("collab.session"),
    description: "Rooms with concurrent editing by two or more people (a 10-minute window)",
  },
  {
    metric: "activation.cohort",
    unit: "count",
    class: "derived",
    dims: [],
    periods: ["week"],
    available: true,
    description: "Organisations created in the week (Activation 7d denominator)",
  },
  {
    metric: "activation.reached",
    unit: "count",
    class: "derived",
    dims: [],
    periods: ["week"],
    available: true,
    description: "Of those, organisations that reached the first value within 7 days",
  },
  {
    metric: "retention.cohort",
    unit: "count",
    class: "derived",
    dims: ["cohort", "offset"],
    periods: ["week"],
    available: true,
    description: "Organisations in a creation-week cohort (retention denominator)",
  },
  {
    metric: "retention.active",
    unit: "count",
    class: "derived",
    dims: ["cohort", "offset"],
    periods: ["week"],
    available: true,
    description: "Of that cohort, organisations with an event in the observation week",
  },
  {
    metric: "feature.used",
    unit: "count",
    class: "derived",
    dims: ["feature"],
    periods: ["week"],
    available: eventPresent("feature.used"),
    description: "Organisations that used a feature in the week",
  },
  {
    metric: "template.used",
    unit: "count",
    class: "derived",
    dims: ["template"],
    periods: ["week"],
    available: eventPresent("template.used"),
    description: "Rooms created from a template, by template",
  },
  {
    metric: "invites.sent",
    unit: "count",
    class: "derived",
    dims: [],
    periods: ["day"],
    available: true,
    description: "Invitations created in the day",
  },
  {
    metric: "invites.accepted",
    unit: "count",
    class: "derived",
    dims: [],
    periods: ["day"],
    available: true,
    description: "Invitations accepted in the day",
  },
  {
    metric: "money.mrr",
    unit: "currency-minor",
    class: "snapshot",
    dims: ["currency", "plan"],
    available: true,
    description: "Active subscriptions normalised to a month, by currency and plan",
  },
  {
    metric: "money.paying",
    unit: "count",
    class: "snapshot",
    dims: [],
    available: true,
    description: "Organisations with an active paid subscription",
  },
]);

/** An event name is an instrument only when the metrics contract knows it. */
function eventPresent(name) {
  return Object.hasOwn(METRIC_CATALOG, name);
}

const BY_NAME = new Map(METRICS.map((entry) => [entry.metric, entry]));

export function metricEntry(name) {
  return BY_NAME.get(name) ?? null;
}

/** True when this version can observe the raw fact behind the metric. */
export function metricAvailable(name) {
  return metricEntry(name)?.available === true;
}

export function metricsFor(period = null) {
  return METRICS.filter((entry) => {
    if (!entry.available) return false;
    if (!period) return true;
    // A metric without a period list is a daily one; the list only names the others.
    return (entry.periods ?? ["day"]).includes(period);
  });
}

/** Normalise a dimension value as §4.1 requires: lowercase, safe alphabet, ≤ 40 chars. */
export function normalizeDim(value, fallback = "other") {
  const text = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return text || fallback;
}

/**
 * The dimensions actually written. A null or unknown key is dropped rather than stored:
 * `metrics_daily_dims_check` would reject it, and an absent split is the honest shape.
 */
export function normalizeDims(dims = {}) {
  const out = {};
  for (const [key, value] of Object.entries(dims)) {
    if (!DIMS.includes(key) || value === null || value === undefined) continue;
    if (key === "period") {
      if (value === "week" || value === "month") out.period = value;
      continue;
    }
    if (key === "offset") {
      if (Number.isInteger(value) && value >= 0 && value <= 52) out.offset = value;
      continue;
    }
    if (key === "cohort") {
      out.cohort = normalizeDim(value);
      continue;
    }
    if (key === "currency") {
      out.currency = String(value).trim().toUpperCase().slice(0, 3);
      continue;
    }
    out[key] = normalizeDim(value);
  }
  return out;
}

/** True when an export has to hide this row's value (`spec/pulse.md` §5.1). */
export function suppressesSmallCell(dims, value) {
  if (value === null || value === undefined) return false;
  if (value < 0 || value >= SUPPRESSION_FLOOR) return false;
  return SUPPRESSED_DIMS.some((key) => Object.hasOwn(dims ?? {}, key));
}
