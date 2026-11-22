/**
 * `operator:grant`, `operator:revoke` and `operator:list` (ADR-259, `spec/operator.md` §2).
 *
 * The role is granted only from the server shell: no API route in the service may write
 * `instance_operators`, and the acceptance test scans the route modules for exactly that.
 * A grant names an existing account with a confirmed address; a revoke refuses to remove
 * the last operator, because then nobody could grant the next one. Both write an audit row
 * with the operator's reason, and `--as` names the operator: every command that changes
 * money, rights or a measure has an author, never a blank `created_by` (ADR-259 amendment).
 */
import { operatorAudit } from "./operator-audit.mjs";
import { PostgresStore } from "./postgres.mjs";

/**
 * The refusal every money and measure command shares. A blank author is what the
 * amendment closed: shell access is the root of trust, but the journal must still say
 * which operator acted.
 */
export const OPERATOR_ACTOR_HINT =
  "--as <operator id|email> is required (or set REMO_OPERATOR): every operator command names its author";

export const OPERATOR_ROLE_USAGE = `usage:
  pnpm operator:grant  --email <address> --reason "..." --as <operator>
  pnpm operator:revoke --email <address> --reason "..." --as <operator>
  pnpm operator:list

  --email    the account that holds (or will hold) the role.
  --reason   why the role changes; stored in the audit row. Required.
  --as       the operator performing the command, an id or an address. Required; the
             environment variable REMO_OPERATOR is the fallback.

  The first operator names the account being granted, because no operator exists yet:
  \`pnpm operator:grant --email you@example.com --as you@example.com --reason bootstrap\`.

The role is per installation and is never granted through the API.`;

/**
 * The value of `--as`, falling back to `REMO_OPERATOR`. `null` when neither is set;
 * callers that change something call `requireOperatorActorValue` instead of guessing.
 */
export function operatorActorValue(as, env = process.env) {
  const flag = String(as ?? "").trim();
  if (flag) return flag;
  const fromEnv = String(env.REMO_OPERATOR ?? "").trim();
  return fromEnv || null;
}

export function requireOperatorActorValue(as, env = process.env) {
  const value = operatorActorValue(as, env);
  if (!value) throw new Error(OPERATOR_ACTOR_HINT);
  return value;
}

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
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`--${name} needs a value`);
    }
    flags.set(name, value);
    index += 1;
  }
  return { flags, positionals };
}

/** Parse one of the three commands. Pure: no environment and no database. */
export function parseOperatorRoleArgs(command, argv) {
  if (!["grant", "revoke", "list"].includes(command)) {
    throw new Error(`unknown operator command ${command}`);
  }
  if (argv.includes("--help") || argv.includes("-h")) {
    return { command, help: true };
  }
  if (command !== "list" && argv.length === 0) {
    return { command, help: true };
  }
  const { flags, positionals } = readFlags(argv);
  if (positionals.length > 0) throw new Error(`unexpected argument ${positionals[0]}`);
  for (const name of flags.keys()) {
    if (!["email", "reason", "as"].includes(name)) {
      throw new Error(`operator:${command} does not take --${name}`);
    }
  }
  if (command === "list") {
    if (flags.size > 0) throw new Error("operator:list takes no flags");
    return { command, help: false };
  }

  const email = String(flags.get("email") ?? "").trim().toLowerCase();
  if (!email) throw new Error("--email is required");
  if (!email.includes("@")) throw new Error("--email must be an email address");
  const reason = String(flags.get("reason") ?? "").trim();
  if (!reason) throw new Error("--reason is required: an operator action without a reason is refused");
  const as = flags.has("as") ? String(flags.get("as")).trim() : null;
  if (as === "") throw new Error("--as needs an operator id or email address");
  return { command, help: false, email, reason, as };
}

function openStore(env) {
  const connectionString = env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required: the role lives in Postgres");
  return new PostgresStore({
    connectionString,
    migrationConnectionString: env.REMO_MIGRATION_DATABASE_URL ?? connectionString,
    log: console,
  });
}

/** The operator named by `--as`: it must exist and already hold the role. */
export async function resolveOperator(store, value, { bootstrapEmail = null } = {}) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const user = text.includes("@")
    ? await store.findUserByEmail(text.toLowerCase())
    : await store.findUserById(text);
  if (!user) throw new Error(`no account matches --as ${text}`);
  if (!(await store.isInstanceOperator(user.id))) {
    // The documented bootstrap: the first operator names the account being granted,
    // because nobody holds the role yet. Any other grant or revoke still demands an
    // existing operator (ADR-259 amendment).
    const bootstrap =
      bootstrapEmail &&
      String(user.email ?? "").toLowerCase() === String(bootstrapEmail).toLowerCase() &&
      (await store.listInstanceOperators()).length === 0;
    if (!bootstrap) throw new Error(`--as ${text} is not an instance operator`);
  }
  return user;
}

/**
 * The author of one command. Role is always checked, so a command cannot be run as a
 * person who merely has a shell account. The one exception is the documented
 * self-bootstrap of the first operator.
 */
export async function requireOperatorActor(
  store,
  as,
  { env = process.env, bootstrapEmail = null } = {},
) {
  const value = requireOperatorActorValue(as, env);
  const actor = await resolveOperator(store, value, { bootstrapEmail });
  if (!actor) throw new Error(OPERATOR_ACTOR_HINT);
  return actor;
}

/**
 * The testable command body: a store may be injected, nothing calls `process.exit`.
 * Returns an exit code and prints through `out`/`err`.
 */
export async function runOperatorRole({
  command,
  argv,
  env = process.env,
  store = null,
  out = console.log,
  err = console.error,
} = {}) {
  let args;
  try {
    args = parseOperatorRoleArgs(command, argv);
  } catch (error) {
    err(`[operator:${command}] ${error.message}`);
    err(OPERATOR_ROLE_USAGE);
    return 1;
  }
  if (args.help) {
    out(OPERATOR_ROLE_USAGE);
    return 0;
  }

  // The author is refused before a database connection is opened: a missing `--as`
  // must not depend on the store being reachable.
  if (command !== "list") {
    try {
      requireOperatorActorValue(args.as, env);
    } catch (error) {
      err(`[operator:${command}] ${error.message}`);
      err(OPERATOR_ROLE_USAGE);
      return 1;
    }
  }

  let opened = null;
  try {
    const active = store ?? (opened = openStore(env));
    if (!store) await active.connect();

    if (command === "list") {
      const operators = await active.listInstanceOperators();
      if (operators.length === 0) {
        out("[operator:list] no instance operators");
        return 0;
      }
      for (const operator of operators) {
        out(
          `${operator.email} (${operator.userId}) granted ${new Date(operator.grantedAt).toISOString()}` +
            (operator.grantedByEmail ? ` by ${operator.grantedByEmail}` : ""),
        );
      }
      return 0;
    }

    const actor = await requireOperatorActor(active, args.as, {
      env,
      // A grant may bootstrap the first operator by naming the account being granted.
      bootstrapEmail: command === "grant" ? args.email : null,
    });
    const target = await active.findUserByEmail(args.email);
    if (!target) {
      err(`[operator:${command}] no account with the address ${args.email}`);
      return 1;
    }

    if (command === "grant") {
      if (target.state !== "active") {
        err(`[operator:grant] ${args.email} is ${target.state}; only an active account can hold the role`);
        return 1;
      }
      if (!target.email_verified_at) {
        err(
          `[operator:grant] ${args.email} has no confirmed address; confirm it in the app first`,
        );
        return 1;
      }
      const granted = await active.grantInstanceOperator({
        email: args.email,
        grantedBy: actor.id,
      });
      await active.recordAudit(
        operatorAudit({
          channel: "cli",
          actorId: actor.id,
          action: "operator.granted",
          subject: granted.userId,
          after: { email: granted.email },
          reason: args.reason,
        }),
      );
      out(`[operator:grant] ${granted.email} (${granted.userId}) now holds the operator role`);
      return 0;
    }

    const revoked = await active.revokeInstanceOperator({ email: args.email });
    if (!revoked.removed) {
      out(`[operator:revoke] ${args.email} does not hold the operator role; nothing changed`);
      return 0;
    }
    await active.recordAudit(
      operatorAudit({
        channel: "cli",
        actorId: actor.id,
        action: "operator.revoked",
        subject: revoked.userId,
        reason: args.reason,
      }),
    );
    out(`[operator:revoke] ${revoked.email} (${revoked.userId}) lost the operator role`);
    return 0;
  } catch (error) {
    err(`[operator:${command}] ${error.code ? `${error.code}: ` : ""}${error.message ?? error}`);
    return 1;
  } finally {
    await opened?.close?.().catch(() => {});
  }
}
