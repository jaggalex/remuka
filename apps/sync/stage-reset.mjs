/**
 * `pnpm stage:reset --yes` (ADR-261, `spec/stage.md` §6).
 *
 * Acceptance deletes data, so the stand needs a way back to the fixtures that is one
 * command and leaves a record. The reset stops the service, drops the instance's own
 * database, lets the ordinary migration create it again, runs `stage:seed` and empties
 * Mailpit. Without `REMO_STAGE=1` it refuses before anything is stopped.
 *
 * The database is never guessed from a default: the name comes from
 * `REMO_MIGRATION_DATABASE_URL` (or `DATABASE_URL`) and the module refuses to drop
 * `postgres`, the maintenance database it connects to.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { userInfo } from "node:os";
import { promisify } from "node:util";
import { assertStage, isStage } from "./stage.mjs";
import { runStageSeed } from "./stage-seed.mjs";

const run = promisify(execFile);

/** Mailpit's own API; the stand's catcher holds no real mail. */
export const DEFAULT_MAILPIT_URL = "http://mail:8025";

export function maintenanceUrl(databaseUrl) {
  const url = new URL(String(databaseUrl));
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error("stage:reset needs a postgres:// connection string");
  }
  return { url, database: decodeURIComponent(url.pathname.replace(/^\//, "")) };
}

/** A database name is an identifier, not a value: it cannot be a bound parameter. */
export function quoteIdentifier(name) {
  const value = String(name ?? "");
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`refusing to reset a database named ${JSON.stringify(value)}`);
  }
  return `"${value}"`;
}

/** `docker compose … stop sync|start sync`, or `null` when this host does not own it. */
export function composeServiceCommand(env, action) {
  const project = String(env.REMO_COMPOSE_PROJECT ?? "").trim();
  if (!project) return null;
  if (action !== "stop" && action !== "start") throw new Error("unknown compose action");
  const args = ["compose", "-p", project];
  const envFile = String(env.REMO_PRODUCTION_ENV ?? "").trim();
  if (envFile) args.push("--env-file", envFile);
  const file = String(env.REMO_STAGE_COMPOSE_FILE ?? "").trim() || "deploy/compose.production.yml";
  if (existsSync(file)) args.push("-f", file);
  args.push(action, "sync");
  return { command: "docker", args };
}

function actorName(env) {
  return String(env.REMO_STAGE_RESET_ACTOR ?? "").trim() || userInfo().username || "unknown";
}

async function service(env, action, log) {
  const spec = composeServiceCommand(env, action);
  if (!spec) {
    log.log(`reset: ${action} skipped: REMO_COMPOSE_PROJECT is not set on this host`);
    return;
  }
  const [command, args] = [spec.command, spec.args];
  try {
    await run(command, args, { timeout: 120_000 });
    log.log(`reset: ${action} ${env.REMO_COMPOSE_PROJECT}/sync`);
  } catch (error) {
    throw new Error(
      `stage:reset could not ${action} the service (docker compose -p ${env.REMO_COMPOSE_PROJECT}): ` +
        `${error?.stderr?.trim() || error?.message || error}`,
    );
  }
}

async function emptyMailpit(env, log) {
  const base = String(env.REMO_STAGE_MAILPIT_URL ?? "").trim() || DEFAULT_MAILPIT_URL;
  try {
    const response = await fetch(`${base.replace(/\/+$/, "")}/api/v1/messages`, {
      method: "DELETE",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    log.log(`reset: Mailpit emptied at ${base}`);
  } catch (error) {
    // The database is already reset; a stopped catcher must not turn a good reset into a
    // failure. The line is the operator's signal to empty it by hand.
    log.log(`reset: Mailpit at ${base} could not be emptied (${error?.message ?? error})`);
  }
}

async function logReset(env, log, text) {
  const line = `${new Date().toISOString()} ${text}`;
  log.log(line);
  const file = String(env.REMO_STAGE_RESET_LOG ?? "").trim();
  if (!file) return;
  const { appendFile } = await import("node:fs/promises");
  await appendFile(file, `${line}\n`, { mode: 0o600 });
}

/**
 * The reset itself. `store` is only used for its `pg` handle when a caller already has
 * one; the normal path opens its own owner connection for the drop and a fresh app
 * connection for the migration.
 */
export async function runStageReset({
  env = process.env,
  yes = false,
  store = null,
  log = console,
  openStore = null,
} = {}) {
  assertStage(env, "stage:reset");
  if (!yes) {
    throw new Error("stage:reset is destructive: pass --yes (spec/stage.md §6)");
  }
  const ownerUrl = String(
    env.REMO_MIGRATION_DATABASE_URL ?? env.DATABASE_URL ?? "",
  ).trim();
  const appUrl = String(env.DATABASE_URL ?? "").trim();
  if (!ownerUrl || !appUrl) {
    throw new Error(
      "stage:reset needs DATABASE_URL and REMO_MIGRATION_DATABASE_URL for the instance",
    );
  }
  const { url: owner, database } = maintenanceUrl(ownerUrl);
  if (database === "postgres" || database === "template1") {
    throw new Error(`refusing to drop the maintenance database ${database}`);
  }
  const who = actorName(env);

  await service(env, "stop", log);
  try {
    const adminUrl = new URL(owner.toString());
    adminUrl.pathname = "/postgres";

    const pg = store?.pg ?? (await import("pg")).default;
    const admin = new pg.Client({
      connectionString: adminUrl.toString(),
      connectionTimeoutMillis: 10_000,
    });
    await admin.connect();
    try {
      await admin.query(
        "select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()",
        [database],
      );
      await admin.query(`drop database if exists ${quoteIdentifier(database)}`);
      await admin.query(`create database ${quoteIdentifier(database)}`);
    } finally {
      await admin.end().catch(() => {});
    }
    log.log(`reset: database ${database} recreated`);

    const open =
      openStore ??
      (async (connectionString) => {
        const { PostgresStore } = await import("./postgres.mjs");
        const created = new PostgresStore({
          connectionString,
          migrationConnectionString: ownerUrl,
          log,
        });
        await created.connect();
        return created;
      });
    const fresh = await open(appUrl);
    try {
      await fresh.migrate();
      log.log(`reset: migrations applied`);
      await runStageSeed({ env, store: fresh, log });
    } finally {
      await fresh.close?.().catch(() => {});
    }

    await emptyMailpit(env, log);
    await logReset(env, log, `stage:reset by ${who} (database ${database})`);
  } finally {
    // A failed reset must not leave the stand switched off: the operator needs the
    // service back to read the error and run the command again.
    await service(env, "start", log);
  }
  return { database, actor: who, at: new Date().toISOString() };
}

/** The command wrapper, with `--yes` parsed before any environment is trusted. */
export async function resetFromArguments({ argv = process.argv.slice(2), env = process.env, log = console } = {}) {
  const yes = argv.includes("--yes");
  if (argv.includes("--help") || argv.includes("-h")) {
    log.log(
      "usage: pnpm stage:reset --yes\n\n" +
        "Drops and recreates this stand's database, runs migrations and stage:seed.\n" +
        "Only with REMO_STAGE=1; never on production. Who and when are written to\n" +
        "REMO_STAGE_RESET_LOG when it is set, and always to the service log.",
    );
    return { help: true };
  }
  for (const item of argv) {
    if (item !== "--yes") throw new Error(`stage:reset does not take ${item}`);
  }
  if (!isStage(env)) assertStage(env, "stage:reset");
  return runStageReset({ env, yes, log });
}
