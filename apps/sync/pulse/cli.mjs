/**
 * The shell commands of the Pulse (`spec/pulse.md` §4.4, §5.3, §5.4).
 *
 * `pulse:recompute` is the same writer and the same advisory lock as the nightly timer.
 * `pulse:peer:list` is a read. `pulse:peer:revoke` removes one peer's rows and its state
 * row in a single metrics transaction and writes `pulse.peer_revoked` with the reason and
 * the operator named by `--as` — every command that changes rights has an author
 * (ADR-259 amendment).
 *
 * The command bodies are injectable: no `process.exit`, no global store, so the refusals
 * are unit-tested without a database.
 */
import { BRAND } from "@remo/brand";
import { PostgresStore } from "../postgres.mjs";
import { operatorAudit } from "../operator-audit.mjs";
import { requireOperatorActor, requireOperatorActorValue, OPERATOR_ACTOR_HINT } from "../operator-role.mjs";
import { addDays, dayOf, fromDay } from "./time.mjs";
import { oldestRecomputableDay, recompute } from "./aggregate.mjs";
import { openMetricsPool, peerStates, deletePeerZone } from "./store.mjs";

export const PULSE_RECOMPUTE_USAGE = `usage:
  pnpm pulse:recompute --from 2026-11-01 --to 2026-11-23

  Recomputes the UTC days of a closed range. \`--to\` defaults to yesterday and
  \`--from\` to three days before it. A day older than 730 days or a future day is refused.
  Needs DATABASE_URL (billing and organisations) and REMO_METRICS_DATABASE_URL.`;

export const PULSE_PEER_LIST_USAGE = `usage:
  pnpm pulse:peer:list

  Shows every peer the collector has read: origin, zone, last success, last day, rows and
  the last error. Read-only; no author is needed.`;

export const PULSE_PEER_REVOKE_USAGE = `usage:
  pnpm pulse:peer:revoke --origin https://${BRAND.domains.appRu} --reason "..." --as <operator>

  Removes every aggregate of that peer's zone and its state row, and writes the
  \`pulse.peer_revoked\` audit row. Also remove the origin from REMO_PULSE_PEERS, otherwise
  the next collection brings the rows back (§5.4).`;

function readFlags(args, booleans = new Set(["help"])) {
  const flags = new Map();
  const positionals = [];
  for (let index = 0; index < args.length; index += 1) {
    const item = args[index];
    if (!item.startsWith("--")) {
      positionals.push(item);
      continue;
    }
    const name = item.slice(2);
    if (booleans.has(name)) {
      flags.set(name, true);
      continue;
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`--${name} needs a value`);
    flags.set(name, value);
    index += 1;
  }
  return { flags, positionals };
}

function parseWindowArgs(argv, now) {
  const { flags, positionals } = readFlags(argv);
  if (positionals.length) throw new Error(`unexpected argument ${positionals[0]}`);
  for (const name of flags.keys()) {
    if (!["from", "to"].includes(name)) throw new Error(`pulse:recompute does not take --${name}`);
  }
  const yesterday = addDays(dayOf(now), -1);
  const to = String(flags.get("to") ?? yesterday);
  const from = String(flags.get("from") ?? addDays(to, -2));
  for (const [name, value] of [["from", from], ["to", to]]) {
    try {
      fromDay(value);
    } catch {
      throw new Error(`--${name} must be a UTC day (YYYY-MM-DD)`);
    }
  }
  if (from > to) throw new Error("--from must not be after --to");
  if (to > yesterday) throw new Error("--to must not be in the future; the last full day is yesterday");
  const oldest = oldestRecomputableDay(now);
  if (from < oldest) throw new Error(`--from is older than the 730-day window (oldest ${oldest})`);
  return { from, to };
}

function openStore(env) {
  const connectionString = env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required: billing and organisations live there");
  return new PostgresStore({
    connectionString,
    migrationConnectionString: env.REMO_MIGRATION_DATABASE_URL ?? connectionString,
    log: console,
  });
}

function zoneOf(env) {
  const zone = String(env.REMO_COMPLIANCE_ZONE ?? "none");
  if (!["eu", "ru", "none"].includes(zone)) {
    throw new Error("REMO_COMPLIANCE_ZONE must be eu, ru or none");
  }
  return zone;
}

/* ---------------------------------------------------------------- recompute -- */

export async function runPulseRecompute({
  argv = [],
  env = process.env,
  store = null,
  pool = null,
  out = console.log,
  err = console.error,
  now = new Date(),
  log = console,
} = {}) {
  if (argv.includes("--help") || argv.includes("-h")) {
    out(PULSE_RECOMPUTE_USAGE);
    return 0;
  }
  let windowArgs;
  try {
    windowArgs = parseWindowArgs(argv, now);
  } catch (error) {
    err(`[pulse:recompute] ${error.message}`);
    err(PULSE_RECOMPUTE_USAGE);
    return 1;
  }

  let openedStore = null;
  let openedPool = null;
  try {
    const active = store ?? (openedStore = openStore(env));
    if (!store) await active.connect();
    const metricsPool = pool ?? (openedPool = await openMetricsPool(env));
    if (!metricsPool) {
      err("[pulse:recompute] REMO_METRICS_DATABASE_URL is not set; there is no metrics database to write");
      return 1;
    }
    const result = await recompute({
      pool: metricsPool,
      store: active,
      zone: zoneOf(env),
      from: windowArgs.from,
      to: windowArgs.to,
      now,
      log,
    });
    out(`[pulse:recompute] ${result.days.length} days written, ${result.failed.length} failed`);
    for (const failure of result.failed) err(`[pulse:recompute] ${failure.day}: ${failure.error}`);
    return result.ok ? 0 : 1;
  } catch (error) {
    err(`[pulse:recompute] ${error.message ?? error}`);
    return 1;
  } finally {
    await openedPool?.end?.().catch(() => {});
    await openedStore?.close?.().catch(() => {});
  }
}

/* -------------------------------------------------------------- peer:list -- */

export async function runPulsePeerList({
  argv = [],
  env = process.env,
  pool = null,
  out = console.log,
  err = console.error,
} = {}) {
  if (argv.includes("--help") || argv.includes("-h")) {
    out(PULSE_PEER_LIST_USAGE);
    return 0;
  }
  if (argv.length) {
    err("[pulse:peer:list] takes no arguments");
    err(PULSE_PEER_LIST_USAGE);
    return 1;
  }
  let openedPool = null;
  try {
    const metricsPool = pool ?? (openedPool = await openMetricsPool(env));
    if (!metricsPool) {
      err("[pulse:peer:list] REMO_METRICS_DATABASE_URL is not set");
      return 1;
    }
    const states = await peerStates(metricsPool);
    if (!states.length) {
      out("[pulse:peer:list] no peers collected");
      return 0;
    }
    for (const state of states) {
      out(
        `${state.origin} zone ${state.zone}` +
          (state.lastSuccessAt ? ` last success ${new Date(state.lastSuccessAt).toISOString()}` : " never collected") +
          (state.lastDay ? ` last day ${state.lastDay}` : "") +
          (state.lastRows !== null ? ` rows ${state.lastRows}` : "") +
          (state.lastError ? ` error ${state.lastError}` : ""),
      );
    }
    return 0;
  } catch (error) {
    err(`[pulse:peer:list] ${error.message ?? error}`);
    return 1;
  } finally {
    await openedPool?.end?.().catch(() => {});
  }
}

/* ------------------------------------------------------------ peer:revoke -- */

/** `https://host` with no path, credentials or query. */
export function normalisePeerOrigin(value) {
  let url;
  try {
    url = new URL(String(value ?? ""));
  } catch {
    throw new Error("--origin must be an https origin");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("--origin must be an https origin");
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error("--origin must be a scheme and a host only, without a path");
  }
  return url.origin;
}

export async function runPulsePeerRevoke({
  argv = [],
  env = process.env,
  store = null,
  pool = null,
  out = console.log,
  err = console.error,
} = {}) {
  if (argv.includes("--help") || argv.includes("-h")) {
    out(PULSE_PEER_REVOKE_USAGE);
    return 0;
  }
  let flags;
  try {
    const parsed = readFlags(argv);
    if (parsed.positionals.length) throw new Error(`unexpected argument ${parsed.positionals[0]}`);
    flags = parsed.flags;
    for (const name of flags.keys()) {
      if (!["origin", "reason", "as"].includes(name)) {
        throw new Error(`pulse:peer:revoke does not take --${name}`);
      }
    }
  } catch (error) {
    err(`[pulse:peer:revoke] ${error.message}`);
    err(PULSE_PEER_REVOKE_USAGE);
    return 1;
  }

  let origin;
  try {
    origin = normalisePeerOrigin(flags.get("origin"));
    if (!String(flags.get("reason") ?? "").trim()) {
      throw new Error("--reason is required: a revoke without a reason is refused");
    }
    requireOperatorActorValue(flags.get("as"), env);
  } catch (error) {
    err(`[pulse:peer:revoke] ${error.message}`);
    err(PULSE_PEER_REVOKE_USAGE);
    return 1;
  }

  let openedStore = null;
  let openedPool = null;
  try {
    const active = store ?? (openedStore = openStore(env));
    if (!store) await active.connect();
    const metricsPool = pool ?? (openedPool = await openMetricsPool(env));
    if (!metricsPool) {
      err("[pulse:peer:revoke] REMO_METRICS_DATABASE_URL is not set");
      return 1;
    }
    const actor = await requireOperatorActor(active, flags.get("as"), { env });
    const states = await peerStates(metricsPool);
    const state = states.find((row) => row.origin === origin);
    if (!state) {
      err(`[pulse:peer:revoke] ${origin} was never collected; nothing to revoke`);
      return 1;
    }
    const client = await metricsPool.connect();
    let removed = 0;
    try {
      removed = await deletePeerZone(client, { zone: state.zone });
    } finally {
      client.release();
    }
    // The audit lives in the product database, so it cannot share the metrics
    // transaction. The deletion is the act; the journal row follows immediately and a
    // failure is reported instead of being swallowed (§5.4, ADR-092).
    try {
      await active.recordAudit(
        operatorAudit({
          channel: "cli",
          actorId: actor.id,
          action: "pulse.peer_revoked",
          subject: origin,
          reason: String(flags.get("reason")).trim(),
          after: { origin, zone: state.zone, rows: removed },
        }),
      );
    } catch (error) {
      err(
        `[pulse:peer:revoke] the ${state.zone} rows are deleted, but the audit row failed: ` +
          `${error.message ?? error}. Record it now: origin ${origin}, zone ${state.zone}, rows ${removed}.`,
      );
      return 1;
    }
    out(`[pulse:peer:revoke] removed ${removed} rows of zone ${state.zone} for ${origin}`);
    return 0;
  } catch (error) {
    err(`[pulse:peer:revoke] ${error.code ? `${error.code}: ` : ""}${error.message ?? error}`);
    return 1;
  } finally {
    await openedPool?.end?.().catch(() => {});
    await openedStore?.close?.().catch(() => {});
  }
}

export { OPERATOR_ACTOR_HINT };
