#!/usr/bin/env node
/**
 * `mfa:reset` — the only way to remove a lost second factor (ADR-260, `spec/totp.md` §7).
 *
 * There is deliberately no "lost my phone, send me a link": a reset by mail would let a
 * stolen mailbox bypass the factor it exists to protect. The command runs on the server,
 * names an author who already holds `instance_operators`, deletes the secret, the recovery
 * codes and every live challenge, ends every session of that account and writes the
 * `mfa.reset` audit row with the reason.
 *
 *   pnpm mfa:reset --email <address> --reason "..." --as <operator>
 *
 * `--as` follows the ADR-259 amendment: every command that changes rights, money or a
 * measure names its author, and this one changes the lock on the console. `REMO_OPERATOR`
 * is the fallback, as it is for the other operator commands.
 *
 * The command body is exported with an injected store so the rules run without a
 * database; the process wrapper is the last lines of the file.
 */
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PostgresStore } from "../apps/sync/postgres.mjs";
import { queueMfaLetter } from "../apps/sync/mfa-mail.mjs";
import { operatorAudit } from "../apps/sync/operator-audit.mjs";
import {
  OPERATOR_ACTOR_HINT,
  requireOperatorActor,
  requireOperatorActorValue,
} from "../apps/sync/operator-role.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export const USAGE = `usage:
  pnpm mfa:reset --email <address> --reason "..." --as <operator>

  --email    the account whose second factor is removed.
  --reason   why the factor is reset; stored in the audit row. Required.
  --as       the operator performing the command, an id or an address. Required;
             REMO_OPERATOR is the fallback.

The command removes the TOTP secret, every recovery code and every pending sign-in
challenge, and ends all sessions of that account. The next console sign-in requires
enrolment again. There is no reset by mail: access to the server is the root of trust.`;

function readFlags(args) {
  const flags = new Map();
  const positionals = [];
  for (let index = 0; index < args.length; index += 1) {
    const item = args[index];
    if (!item.startsWith("--")) {
      positionals.push(item);
      continue;
    }
    const name = item.slice(2);
    if (name === "help") {
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

/** Pure: an operator typo stops before a database is opened. */
export function parseMfaResetArgs(argv) {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    return { help: true };
  }
  const { flags, positionals } = readFlags(argv);
  if (positionals.length > 0) throw new Error(`unexpected argument ${positionals[0]}`);
  for (const name of flags.keys()) {
    if (!["email", "reason", "as", "help"].includes(name)) {
      throw new Error(`mfa:reset does not take --${name}`);
    }
  }
  const email = String(flags.get("email") ?? "").trim().toLowerCase();
  if (!email) throw new Error("--email is required");
  if (!email.includes("@")) throw new Error("--email must be an email address");
  const reason = String(flags.get("reason") ?? "").trim();
  if (!reason) throw new Error("--reason is required: a reset without a reason is refused");
  const as = flags.has("as") ? String(flags.get("as")).trim() : null;
  if (as === "") throw new Error("--as needs an operator id or email address");
  return { help: false, email, reason, as };
}

function openStore(env) {
  const connectionString = env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required: the factor lives in Postgres");
  return new PostgresStore({
    connectionString,
    migrationConnectionString: env.REMO_MIGRATION_DATABASE_URL ?? connectionString,
    log: console,
  });
}

/**
 * The testable command body: no `process.exit`, a store injected by the caller, one exit
 * code and output through `out`/`err`.
 */
export async function runMfaReset({
  argv,
  env = process.env,
  store = null,
  out = console.log,
  err = console.error,
} = {}) {
  let args;
  try {
    args = parseMfaResetArgs(argv);
  } catch (error) {
    err(`[mfa:reset] ${error.message}`);
    err(USAGE);
    return 1;
  }
  if (args.help) {
    out(USAGE);
    return 0;
  }

  // The author is refused before a connection is opened: a missing `--as` must not depend
  // on the database being reachable.
  try {
    requireOperatorActorValue(args.as, env);
  } catch (error) {
    err(`[mfa:reset] ${error.message}`);
    err(OPERATOR_ACTOR_HINT);
    err(USAGE);
    return 1;
  }

  let opened = null;
  try {
    const active = store ?? (opened = openStore(env));
    if (!store) await active.connect();

    const actor = await requireOperatorActor(active, args.as, { env });
    const target = await active.findUserByEmail(args.email);
    if (!target) {
      err(`[mfa:reset] no account with the address ${args.email}`);
      return 1;
    }

    const removed = await active.resetMfa(target.id);
    if (!removed.hadSecret) {
      out(`[mfa:reset] ${target.email} has no second factor; nothing changed`);
      return 0;
    }
    // The reset is only real if the sessions it protected are gone too (§7).
    await active.revokeUserSessions(target.id);
    await active.recordAudit(
      operatorAudit({
        channel: "cli",
        actorId: actor.id,
        action: "mfa.reset",
        subject: target.id,
        reason: args.reason,
        after: {
          recoveryCodes: removed.recoveryCodes,
          challenges: removed.challenges,
        },
      }),
    );
    // The reset itself is done; the letter is how the owner learns it was not them
    // (`spec/totp.md` §7). A mail outage is reported, never a reason to keep the factor.
    const notified = await queueMfaLetter({
      store: active,
      userId: target.id,
      toEmail: target.email,
      locale: target.lang,
      template: "mfa_reset",
      env,
    });
    out(
      `[mfa:reset] second factor removed from ${target.email}; every session of the account ended`,
    );
    if (!notified.queued) {
      err(
        `[mfa:reset] the reset stands, but the letter was not queued (${notified.reason}); tell ${target.email} yourself`,
      );
    }
    return 0;
  } catch (error) {
    err(`[mfa:reset] ${error.code ? `${error.code}: ` : ""}${error.message ?? error}`);
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
  process.exitCode = await runMfaReset({ argv: process.argv.slice(2) });
}
