/**
 * `abuse:*`: measures against abuse and their reversal (ADR-259, `spec/operator.md` §4).
 *
 * A measure is a row in `operator_actions`; access reads the open row, so disabling a link,
 * hiding a room and suspending an organisation are not three flags on three tables. The
 * public reason is what participants and administrators see; the internal one stays in the
 * journal. Every measure emails the organisation's administrators, and the command refuses
 * to apply anything when that letter cannot be queued: a suspension without its reason is
 * the thing the rules of use promise will not happen.
 */
import { PostgresStore } from "./postgres.mjs";
import { abuseContact } from "./compliance.mjs";
import { assertMailConfig, enqueueMail, resolveMailConfig } from "./mail.mjs";
import { render } from "./mail-templates.mjs";
import { operatorAudit } from "./operator-audit.mjs";
import { assertOperatorCliMfa } from "./operator-cli-mfa.mjs";
import {
  requireOperatorActor,
  requireOperatorActorValue,
} from "./operator-role.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MEASURES = {
  "link-disable": { kind: "link_disable", subjectType: "board_link", flag: "link" },
  "board-hide": { kind: "board_hide", subjectType: "board", flag: "board" },
  "org-suspend": { kind: "org_suspend", subjectType: "org", flag: "org" },
};

export const ABUSE_USAGE = `usage:
  pnpm abuse:link-disable --link <room-id>  --reason "..." --public "..." [--report <ref>] --as <operator> [--code <six digits>]
  pnpm abuse:board-hide   --board <room-id> --reason "..." --public "..." [--report <ref>] --as <operator> [--code <six digits>]
  pnpm abuse:org-suspend  --org <org-id>    --reason "..." --public "..." [--report <ref>] --as <operator> [--code <six digits>]
  pnpm abuse:revert       <action-id>       --reason "..." --as <operator> [--code <six digits>]
  pnpm abuse:list         [--open] [--limit <n>]

  --reason   the internal explanation, stored in the journal and the audit row. Required.
  --public   what the organisation's administrators are told and participants see. Required.
  --report   the complaint or letter number this measure answers.
  --as       the operator performing the command, an id or an address. Required;
             REMO_OPERATOR is the fallback.
  --code     the operator's six-digit second-factor code (or a recovery code). Asked
             interactively in a terminal; required otherwise.

Every measure letters the organisation's administrators with the public reason and the
address to appeal to. A measure is never applied when that letter cannot be queued.`;

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
    if (name === "help" || name === "open") {
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

export function parseAbuseArgs(command, argv) {
  if (!["link-disable", "board-hide", "org-suspend", "revert", "list"].includes(command)) {
    throw new Error(`unknown abuse command ${command}`);
  }
  if (argv.includes("--help") || argv.includes("-h")) {
    return { command, help: true };
  }
  if (command !== "list" && argv.length === 0) {
    return { command, help: true };
  }
  const { flags, positionals } = readFlags(argv);

  if (command === "list") {
    if (positionals.length > 0) throw new Error(`unexpected argument ${positionals[0]}`);
    for (const name of flags.keys()) {
      if (!["open", "limit"].includes(name)) throw new Error(`abuse:list does not take --${name}`);
    }
    const limit = flags.has("limit") ? Number(flags.get("limit")) : 100;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
      throw new Error("--limit must be an integer between 1 and 500");
    }
    return { command, help: false, openOnly: Boolean(flags.get("open")), limit };
  }

  const measure = MEASURES[command];
  const allowed = measure
    ? [measure.flag, "reason", "public", "report", "as", "code"]
    : ["reason", "as", "code"];
  for (const name of flags.keys()) {
    if (!allowed.includes(name)) throw new Error(`abuse:${command} does not take --${name}`);
  }
  const reason = String(flags.get("reason") ?? "").trim();
  if (!reason) throw new Error("--reason is required: a measure without a reason is refused");
  const code = flags.has("code") ? String(flags.get("code")).trim() : null;
  if (code === "") throw new Error("--code needs the six-digit code from the app");

  if (command === "revert") {
    if (positionals.length !== 1) throw new Error("the action id is required");
    if (!UUID.test(positionals[0])) throw new Error("the action id must be a uuid");
    const as = flags.has("as") ? String(flags.get("as")).trim() : null;
    if (as === "") throw new Error("--as needs an operator id or email address");
    return { command, help: false, actionId: positionals[0], reason, as, code };
  }

  const subject = String(flags.get(measure.flag) ?? "").trim();
  if (!UUID.test(subject) && command !== "board-hide" && command !== "link-disable") {
    throw new Error(`--${measure.flag} must be a uuid`);
  }
  if (!subject) throw new Error(`--${measure.flag} is required`);
  const publicReason = String(flags.get("public") ?? "").trim();
  if (!publicReason) {
    throw new Error("--public is required: the administrators must be told why");
  }
  const report = flags.has("report") ? String(flags.get("report")).trim() : null;
  if (report === "") throw new Error("--report needs a reference");
  const as = flags.has("as") ? String(flags.get("as")).trim() : null;
  if (as === "") throw new Error("--as needs an operator id or email address");
  return {
    command,
    help: false,
    kind: measure.kind,
    subjectType: measure.subjectType,
    subjectId: subject,
    reason,
    publicReason,
    report,
    as,
    code,
  };
}

function openStore(env) {
  const connectionString = env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required: measures live in Postgres");
  return new PostgresStore({
    connectionString,
    migrationConnectionString: env.REMO_MIGRATION_DATABASE_URL ?? connectionString,
    log: console,
  });
}

function iso(value) {
  if (!value) return "—";
  const at = value instanceof Date ? value : new Date(value);
  return Number.isNaN(at.getTime()) ? "—" : at.toISOString();
}

function localeFor(admin, env) {
  if (admin?.lang === "ru" || admin?.lang === "en") return admin.lang;
  return env.REMO_COMPLIANCE_ZONE === "eu" ? "en" : "ru";
}

/**
 * A letter for every administrator. Every recipient's template is rendered once here, so
 * a missing parameter stops the command before the measure is written.
 */
async function queueMeasureLetters({
  store,
  config,
  orgId,
  kind,
  reason,
  restored,
  appeal,
  env,
}) {
  const admins = await store.operatorOrgAdmins(orgId);
  if (admins.length === 0) {
    throw new Error(
      `organisation ${orgId} has no active administrator; nobody could be told about the measure`,
    );
  }
  const appealAddress = appeal;
  for (const admin of admins) {
    const locale = localeFor(admin, env);
    const params = {
      kind,
      reason,
      appeal: appealAddress,
      restored,
    };
    render("operator_action", locale, params);
    await enqueueMail(
      store,
      {
        userId: admin.id,
        toEmail: admin.email,
        template: "operator_action",
        locale,
        params,
      },
      { config },
    );
  }
  return admins;
}

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function mailConfigFor(env, mailConfig) {
  let config;
  try {
    config = mailConfig ?? assertMailConfig(resolveMailConfig(env), { env });
  } catch (error) {
    throw codedError("MAIL_UNAVAILABLE", `mail is not configured: ${error.message ?? error}`);
  }
  if (config.driver === "disabled") {
    throw codedError("MAIL_UNAVAILABLE", "mail is disabled; a measure without its letter is refused");
  }
  return config;
}

function appealAddress(env) {
  const appeal = abuseContact(env);
  if (!appeal) {
    throw codedError(
      "NO_APPEAL_ADDRESS",
      "no complaint address: set REMO_CONTACT_ABUSE (or REMO_COMPLIANCE_ZONE for a cloud installation)",
    );
  }
  return appeal;
}

/**
 * Apply one measure. The one implementation behind `abuse:*` and the console's complaints
 * form (`spec/operator-actions.md` §3.1 rule 4, §4.3). A measure whose letter cannot be
 * queued is rolled back, because a restriction without its reason is the thing the rules
 * of use promise will not happen.
 */
export async function applyMeasure({
  store,
  kind,
  subjectType,
  subjectId,
  reason,
  publicReason = null,
  reportRef = null,
  actor,
  channel = "cli",
  mfa = null,
  env = process.env,
  mailConfig = null,
}) {
  const appeal = appealAddress(env);
  const config = mailConfigFor(env, mailConfig);

  // A measure needs an existing subject; the command reads it before writing anything.
  let orgId;
  if (subjectType === "org") {
    const org = await store.operatorOrg(subjectId);
    if (!org) throw codedError("ORG_NOT_FOUND", `no organisation ${subjectId}`);
    orgId = org.id;
  } else {
    const board = await store.operatorBoard(subjectId);
    if (!board) throw codedError("ROOM_NOT_FOUND", `no room ${subjectId}`);
    orgId = board.orgId;
    if (kind === "link_disable" && !board.linkEnabled) {
      throw codedError("LINK_NOT_ENABLED", `room ${subjectId} has no enabled public link`);
    }
  }

  const { action, created } = await store.recordOperatorAction({
    kind,
    subjectType,
    subjectId,
    reasonInternal: reason,
    reasonPublic: publicReason ?? reason,
    reportRef,
    createdBy: actor.id,
  });
  if (!created) return { action, created: false };

  try {
    await queueMeasureLetters({
      store,
      config,
      orgId,
      kind,
      reason: publicReason ?? reason,
      restored: false,
      appeal,
      env,
    });
  } catch (error) {
    // The measure has no letter, so it must not stand. Reverting its own row restores
    // the organisation flag in the same transaction.
    await store.revertOperatorAction({ id: action.id, revertedBy: actor.id }).catch(() => null);
    throw codedError("MEASURE_LETTER_FAILED", error.message);
  }

  await store.withTenant(orgId, () =>
    store.recordAudit(
      operatorAudit({
        channel,
        mfa,
        actorId: actor.id,
        orgId,
        action:
          kind === "link_disable"
            ? "abuse.link_disabled"
            : kind === "board_hide"
              ? "abuse.board_hidden"
              : "abuse.org_suspended",
        subject: action.id,
        after: { kind, subjectType, subjectId, report: reportRef },
        reason,
      }),
    ),
  );

  return { action, created: true };
}

/** Close one measure and letter the administrators. Shared by the CLI and the console. */
export async function revertMeasure({
  store,
  actionId,
  reason,
  actor,
  channel = "cli",
  mfa = null,
  env = process.env,
  mailConfig = null,
}) {
  const existing = await store.operatorAction(actionId);
  if (!existing) throw codedError("ACTION_NOT_FOUND", `no action ${actionId}`);
  const orgId = await store.operatorActionOrg(existing);
  if (!orgId) throw codedError("SUBJECT_GONE", "the measure's subject no longer exists");
  // The letter is part of the act: the command refuses before lifting anything when mail
  // cannot send it (the CLI has always behaved this way).
  const appeal = appealAddress(env);
  const config = mailConfigFor(env, mailConfig);
  const reverted = await store.revertOperatorAction({ id: actionId, revertedBy: actor.id });
  if (!reverted.changed) {
    return { action: reverted.action, changed: false, mailed: true };
  }
  let mailed = true;
  try {
    await queueMeasureLetters({
      store,
      config,
      orgId,
      kind: reverted.action.kind,
      reason,
      restored: true,
      appeal,
      env,
    });
  } catch {
    mailed = false;
  }
  await store.withTenant(orgId, () =>
    store.recordAudit(
      operatorAudit({
        channel,
        mfa,
        actorId: actor.id,
        orgId,
        action: "abuse.reverted",
        subject: actionId,
        after: { kind: reverted.action.kind, subjectId: reverted.action.subjectId },
        reason,
      }),
    ),
  );
  return { action: reverted.action, changed: true, mailed };
}

export async function runAbuse({
  command,
  argv,
  env = process.env,
  store = null,
  out = console.log,
  err = console.error,
  mailConfig = null,
  kek = undefined,
  stdin = process.stdin,
  stdout = process.stderr,
  ask = undefined,
} = {}) {
  let args;
  try {
    args = parseAbuseArgs(command, argv);
  } catch (error) {
    err(`[abuse:${command}] ${error.message}`);
    err(ABUSE_USAGE);
    return 1;
  }
  if (args.help) {
    out(ABUSE_USAGE);
    return 0;
  }

  // A measure, its reversal and the author are one act; a blank author is refused
  // before the store is opened (ADR-259 amendment).
  if (command !== "list") {
    try {
      requireOperatorActorValue(args.as, env);
    } catch (error) {
      err(`[abuse:${command}] ${error.message}`);
      err(ABUSE_USAGE);
      return 1;
    }
  }

  let opened = null;
  try {
    const active = store ?? (opened = openStore(env));
    if (!store) await active.connect();

    if (command === "list") {
      const actions = await active.listOperatorActions({
        openOnly: args.openOnly,
        limit: args.limit,
      });
      if (actions.length === 0) {
        out(`[abuse:list] no ${args.openOnly ? "open " : ""}measures`);
        return 0;
      }
      for (const action of actions) {
        out(
          `${action.id} ${action.kind} ${action.revertedAt ? "reverted" : "OPEN"}` +
            ` at ${iso(action.createdAt)}` +
            `${action.orgName ? ` org=${action.orgName}` : ""}` +
            `${action.boardTitle !== null ? ` room=${JSON.stringify(action.boardTitle)}` : ""}` +
            ` subject=${action.subjectId}` +
            `${action.reportRef ? ` report=${action.reportRef}` : ""}`,
        );
        out(`  public: ${action.reasonPublic}`);
        out(`  internal: ${action.reasonInternal}`);
      }
      return 0;
    }

    const actor = await requireOperatorActor(active, args.as, { env });
    // A measure restricts a real customer: the acting operator proves the second factor
    // before the reason is even read (`spec/operator-actions.md` §5).
    let proof;
    try {
      proof = await assertOperatorCliMfa({
        store: active,
        actor,
        code: args.code,
        env,
        kek,
        stdin,
        stdout,
        ask,
      });
    } catch (error) {
      err(`[abuse:${command}] ${error.message ?? error}`);
      return 1;
    }
    if (command === "revert") {
      const result = await revertMeasure({
        store: active,
        actionId: args.actionId,
        reason: args.reason,
        actor,
        channel: "cli",
        mfa: proof.mfa,
        env,
        mailConfig,
      });
      if (!result.changed) {
        out(
          `[abuse:revert] ${args.actionId} was already reverted at ${iso(result.action.revertedAt)}`,
        );
        return 0;
      }
      if (!result.mailed) {
        err("[abuse:revert] the measure is lifted, but the letter was not queued");
      }
      out(`[abuse:revert] ${args.actionId} (${result.action.kind}) is lifted`);
      return result.mailed ? 0 : 1;
    }

    const { action, created } = await applyMeasure({
      store: active,
      kind: args.kind,
      subjectType: args.subjectType,
      subjectId: args.subjectId,
      reason: args.reason,
      publicReason: args.publicReason,
      reportRef: args.report,
      actor,
      channel: "cli",
      mfa: proof.mfa,
      env,
      mailConfig,
    });
    if (!created) {
      out(
        `[abuse:${command}] already open since ${iso(action.createdAt)} (${action.id}); nothing changed`,
      );
      return 0;
    }

    out(`[abuse:${command}] ${action.id}: ${args.kind} applied to ${args.subjectId}`);
    out("[abuse] the organisation's administrators received the reason and the appeal address");
    return 0;
  } catch (error) {
    err(`[abuse:${command}] ${error.code ? `${error.code}: ` : ""}${error.message ?? error}`);
    return 1;
  } finally {
    await opened?.close?.().catch(() => {});
  }
}
