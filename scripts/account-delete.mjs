#!/usr/bin/env node
/**
 * Delete an account from the operator's shell (ADR-257, `spec/account-deletion.md` §4).
 *
 *   REMO_OPERATOR=ops@example.com pnpm account:delete --user <id|email> [--reason "..."] [--now]
 *   pnpm account:delete --user <id|email> --as ops@example.com [--reason "..."] [--now]
 *   pnpm account:delete --user <id|email> --dry-run
 *
 * A person deletes their own account in Settings; this command acts for somebody who
 * wrote to the privacy address or for a court order. The role is `instance_operators`
 * (ADR-248), and the operator names themselves with `--operator` or `REMO_OPERATOR`, an id
 * or the address they signed up with. Without `--now` the account stops at once and is
 * erased after fourteen days by the hourly job; `--now` calls that job's own purge
 * immediately, in the same order: unload the rooms, erase the files, then one transaction.
 *
 * `--dry-run` prints the shared organisations whose membership goes, the personal rooms
 * that are deleted and the subscription that will not renew, and writes nothing.
 *
 * Both the permission check and the command live in `account-operator.mjs`; this file is
 * the shell around them, so an operator typo cannot become a row.
 */
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { AccountDeletionError, deletionDueAt } from "../apps/sync/account-deletion.mjs";
import { deleteAccountAsOperator } from "../apps/sync/account-operator.mjs";
import { createFileStore } from "../apps/sync/files-store.mjs";
import { PostgresStore } from "../apps/sync/postgres.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const USAGE = `usage: pnpm account:delete --user <user-id|email> [--reason "..."] [--now]
       [--as <user-id|email>] [--dry-run]

  --user      the account to delete; a uuid or the address on it.
  --reason    why the operator acts; stored in the audit row.
  --now       erase immediately instead of waiting fourteen days. Irreversible.
  --as        the instance operator performing this; REMO_OPERATOR is the fallback.
              The account must hold the instance_operators role (ADR-248).
  --dry-run   print what would be deleted and write nothing.

Without --now the account stops at once and is erased after fourteen days. With --now the
purge is immediate and cannot be undone. Only an instance operator may run this command.`;

/** Flags may repeat; booleans are the two switches. No environment, no database. */
function readFlags(args) {
  const booleans = new Set(["now", "dry-run", "help"]);
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
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`--${name} needs a value`);
    }
    flags.set(name, value);
    index += 1;
  }
  return { flags, positionals };
}

function one(flags, name) {
  const value = flags.get(name);
  return Array.isArray(value) ? value[value.length - 1] : value;
}

/** An operator typo must stop before a database is opened. */
export function parseAccountDeleteArgs(argv) {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    return { help: true };
  }
  const { flags, positionals } = readFlags(argv);
  if (positionals.length > 0) throw new Error(`unexpected argument ${positionals[0]}`);
  for (const name of flags.keys()) {
    if (!["user", "operator", "as", "reason", "now", "dry-run"].includes(name)) {
      throw new Error(`account:delete does not take --${name}`);
    }
  }

  const user = String(one(flags, "user") ?? "").trim();
  if (!user) throw new Error("--user <user-id|email> is required");
  if (!UUID.test(user) && !user.includes("@")) {
    throw new Error("--user must be a user id (uuid) or an email address");
  }

  const operator = one(flags, "as") ?? one(flags, "operator");
  if (one(flags, "as") !== undefined && one(flags, "operator") !== undefined) {
    throw new Error("name the operator once: --as (--operator is the old spelling)");
  }
  const operatorAddress = operator === undefined ? null : String(operator).trim();
  if (operatorAddress === "") throw new Error("--as needs a user id or an email address");
  if (
    operatorAddress &&
    !UUID.test(operatorAddress) &&
    !operatorAddress.includes("@")
  ) {
    throw new Error("--as must be a user id (uuid) or an email address");
  }

  const reason = one(flags, "reason");
  const text = reason === undefined ? null : String(reason).trim();

  return {
    help: false,
    user,
    as: operatorAddress,
    reason: text || null,
    purgeNow: flags.has("now"),
    dryRun: flags.has("dry-run"),
  };
}

function iso(value) {
  if (!value) return "—";
  const at = value instanceof Date ? value : new Date(value);
  return Number.isNaN(at.getTime()) ? "—" : at.toISOString();
}

/**
 * One stable block for the dry run: the same summary the command reads, described in the
 * terms an operator promised to the person who wrote in.
 */
export function formatSummary(summary, { purgeNow = false } = {}) {
  const lines = [
    `user ${summary.user.id} ${summary.user.email} state=${summary.user.state}`,
  ];
  if (summary.sharedOrgs.length === 0) {
    lines.push("shared organisations: none");
  } else {
    lines.push("shared organisations (membership removed, rooms and history stay):");
    for (const org of summary.sharedOrgs) {
      lines.push(`  ${org.name || "(untitled)"} (${org.slug})${org.admin ? " — org_admin" : ""}`);
    }
  }
  if (summary.rooms.length === 0) {
    lines.push("personal rooms to delete: none");
  } else {
    lines.push(`personal rooms to delete: ${summary.rooms.length}`);
    for (const room of summary.rooms) {
      lines.push(`  ${room.archived ? "[archived] " : ""}${room.title || "(untitled)"} (${room.id})`);
    }
  }
  lines.push(
    summary.subscription
      ? `subscription: ${summary.subscription.plan}/${summary.subscription.status} ` +
          `until ${iso(summary.subscription.currentPeriodEnd)} — no renewal`
      : "subscription: none",
  );
  if (summary.blockers.length > 0) {
    lines.push(`BLOCKED — last administrator of ${summary.blockers.length} shared organisation(s):`);
    for (const org of summary.blockers) {
      lines.push(`  ${org.name || "(untitled)"} — ${org.members} other member(s)`);
    }
  }
  lines.push(purgeNow ? "would erase immediately (--now)" : "would stop now and erase after 14 days");
  return lines.join("\n");
}

function openStore(env) {
  const connectionString = env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required: accounts live in Postgres");
  return new PostgresStore({
    connectionString,
    migrationConnectionString: env.REMO_MIGRATION_DATABASE_URL ?? connectionString,
    log: console,
  });
}

/** `--user` and `--operator` accept the same two forms; the address is normalised already. */
async function resolveUser(store, value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (UUID.test(text)) return store.findUserById(text);
  return store.findUserByEmail(text.toLowerCase());
}

/**
 * The testable command body: no `process.exit`, a store and a file store injected by the
 * caller. Returns an exit code and prints through `out`/`err`.
 */
export async function runAccountDelete({
  argv,
  env = process.env,
  store = null,
  fileStore = null,
  out = console.log,
  err = console.error,
} = {}) {
  let args;
  try {
    args = parseAccountDeleteArgs(argv);
  } catch (error) {
    err(`[account:delete] ${error.message}`);
    err(USAGE);
    return 1;
  }
  if (args.help) {
    out(USAGE);
    return 0;
  }

  const operatorAddress = args.as ?? String(env.REMO_OPERATOR ?? "").trim();
  if (!operatorAddress) {
    err("[account:delete] the operator must name themselves: --as <id|email> or REMO_OPERATOR");
    err(USAGE);
    return 1;
  }

  let opened = null;
  try {
    const active = store ?? (opened = openStore(env));
    if (!store) await active.connect();

    const operator = await resolveUser(active, operatorAddress);
    if (!operator) {
      err(`[account:delete] no account matches the operator ${operatorAddress}`);
      return 1;
    }
    const target = await resolveUser(active, args.user);
    if (!target) {
      err(`[account:delete] no account matches ${args.user}`);
      return 1;
    }

    // The file store is built before anything is written: a broken S3 configuration must
    // fail the command, not leave a `deleting` row whose bytes nobody can erase.
    const files = args.purgeNow && !args.dryRun ? (fileStore ?? (await createFileStore(env))) : fileStore;

    const result = await deleteAccountAsOperator({
      store: active,
      userId: target.id,
      actorId: operator.id,
      reason: args.reason,
      purgeNow: args.purgeNow,
      dryRun: args.dryRun,
      fileStore: files,
    });

    if (result.dryRun) {
      out(formatSummary(result.summary, { purgeNow: args.purgeNow }));
      out("nothing changed (--dry-run)");
      return 0;
    }
    if (result.alreadyDeleted) {
      out(`[account:delete] ${target.id}: already deleted; nothing to do`);
      return 0;
    }
    if (result.purged) {
      out(
        `[account:delete] ${target.id}: purged now ` +
          `(rooms ${result.boards ?? 0}, personal organisations ${result.personalOrgs ?? 0}, ` +
          `kept as accounting shells ${result.keptOrgs ?? 0})`,
      );
      return 0;
    }
    out(
      `[account:delete] ${target.id}: deleting; final erasure on ` +
        `${deletionDueAt(result.deletionRequestedAt).toISOString()}`,
    );
    return 0;
  } catch (error) {
    if (error instanceof AccountDeletionError) {
      err(`[account:delete] ${error.code}: ${error.message}`);
      for (const org of error.details?.orgs ?? []) {
        err(`  ${org.name || "(untitled)"} — ${org.members} other member(s)`);
      }
      return 1;
    }
    err(`[account:delete] ${error.message ?? error}`);
    return 1;
  } finally {
    await opened?.close?.().catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.loadEnvFile?.(join(ROOT, ".env"));
  } catch {
    /* the process environment is the source of truth */
  }
  process.exitCode = await runAccountDelete({ argv: process.argv.slice(2) });
}
