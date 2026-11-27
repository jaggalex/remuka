#!/usr/bin/env node
/**
 * Payment connections from the operator's shell (ADR-248, `spec/payment-providers.md`
 * §6.2). Stage 1 has no operator console, so this command is the only way to add, test,
 * pause and retire a provider.
 *
 *   pnpm billing:providers list
 *   pnpm billing:providers create --provider manual --mode live --currency RUB \
 *        --groups invoice --name "Счёт" --activate
 *   pnpm billing:providers set <id> --priority 10 --settings vat_code=1,tax_system_code=2
 *   pnpm billing:providers verify <id>
 *   pnpm billing:providers secret <id> [--secret-file <json>]
 *   pnpm billing:providers activate|pause|resume|retire|disable <id> --reason "..."
 *   pnpm billing:providers webhook-url <id>
 *
 * A secret is never an argument: it comes from `--secret-file` (JSON) or a hidden prompt
 * so it cannot end up in shell history or in a process listing. Only the fingerprint is
 * printed. `manual` needs no secret at all; the refusal for a provider without one is the
 * adapter's, not a hardcoded list here. The KEK is opened only by the commands that
 * actually seal or unseal a secret, so `list` and `webhook-url` work without it.
 *
 * Parsing is exported and pure, so every operator typo is a unit test without a database.
 */
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  requireOperatorActor,
  requireOperatorActorValue,
} from "../apps/sync/operator-role.mjs";
import { fakeProviderEnabled } from "../apps/sync/pay-fake.mjs";
import { openConnectionSecret } from "../apps/sync/payment-connections.mjs";
import {
  METHOD_GROUPS,
  MODES,
  PROVIDERS,
} from "../apps/sync/pg/payment-providers.mjs";
import { PostgresStore } from "../apps/sync/postgres.mjs";
import { encryptSecret, fingerprintSecret, kekFromEnv } from "../apps/sync/secrets.mjs";
import { assertLiveBillingAllowed } from "../apps/sync/stage.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_CURRENCY = /^[A-Z]{3}$/;
const PRIORITY = /^[0-9]+$/;

export const PROVIDER_USAGE = `usage:
  pnpm billing:providers list
  pnpm billing:providers create --provider <${PROVIDERS.join("|")}> --mode <test|live>
       --currency <ISO> [--currency <ISO>] --groups <${METHOD_GROUPS.join("|")}>[,<group>]
       --name "<operator label>" [--priority 100] [--settings key=value[,key=value]]
       [--secret-file <json>] [--activate] --as <operator>
  pnpm billing:providers set <connection-id> [--priority <n>] [--currency <ISO>]
       [--groups <group>[,<group>]] [--settings key=value[,key=value]] --as <operator>
  pnpm billing:providers verify <connection-id>
  pnpm billing:providers secret <connection-id> [--secret-file <json>] [--reason "..."] --as <operator>
  pnpm billing:providers activate|pause|resume|retire|disable <connection-id> [--reason "..."] --as <operator>
  pnpm billing:providers webhook-url <connection-id>

  --secret-file is a JSON object of the adapter's secret fields; it is sealed with
  REMO_KEK and only its fingerprint is printed. A secret is never accepted as a flag:
  without --secret-file, "secret" reads one JSON object from a terminal without echo.
  create probes the provider after validating the configuration; a failed probe leaves
  the connection in draft and exits 1 with the reason. verify probes an existing
  connection and records the answer; it never moves the lifecycle status.
  secret replaces the sealed keys, records an audit row and probes the new ones.
  activate, pause, resume, retire and disable move one step of the lifecycle; pause,
  retire and disable require --reason. disable refuses while live subscriptions remain.
  webhook-url prints REMO_APP_ORIGIN/api/billing/webhooks/<id>/<token>: the public
  application origin proxies /api/ to the service, so the provider's URL carries it.
  Every command that writes a row names its author with --as (REMO_OPERATOR is the
  fallback); list, verify and webhook-url only read and need none. REMO_KEK is required
  by create with a secret, secret and verify of a connection that has one; list,
  webhook-url and a manual verify work without it.`;

/** One command's lifecycle step, so the CLI and the store agree on the edges. */
const STATUS_COMMANDS = Object.freeze({
  activate: { to: "active", from: ["draft", "ready"], needsReason: false },
  pause: { to: "paused", from: ["active"], needsReason: true },
  resume: { to: "active", from: ["paused"], needsReason: false },
  retire: { to: "retiring", from: ["active", "paused"], needsReason: true },
  disable: { to: "disabled", from: ["active", "paused", "retiring"], needsReason: true },
});

/** Flags may repeat; a comma-separated value is the same as repeating the flag. */function readFlags(args, booleans = new Set()) {
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
    const previous = flags.get(name);
    flags.set(name, previous === undefined ? value : [].concat(previous, value));
    index += 1;
  }
  return { flags, positionals };
}

function rejectUnknown(flags, allowed, command) {
  for (const name of flags.keys()) {
    if (!allowed.includes(name)) throw new Error(`${command} does not take --${name}`);
  }
}

function many(flags, name) {
  const value = flags.get(name);
  if (value === undefined) return [];
  return [].concat(value).flatMap((item) => String(item).split(","));
}

function one(flags, name) {
  const value = flags.get(name);
  return Array.isArray(value) ? value[value.length - 1] : value;
}

function currencyList(flags, { required }) {
  const codes = [...new Set(many(flags, "currency").map((code) => code.trim().toUpperCase()).filter(Boolean))];
  if (required && codes.length === 0) {
    throw new Error("--currency is required (a three-letter ISO 4217 code, e.g. RUB)");
  }
  for (const code of codes) {
    if (!ISO_CURRENCY.test(code)) {
      throw new Error(`--currency ${JSON.stringify(code)} is not a three-letter ISO 4217 code`);
    }
  }
  return codes;
}

function groupList(flags, { required }) {
  const groups = [...new Set(many(flags, "groups").map((group) => group.trim()).filter(Boolean))];
  if (required && groups.length === 0) {
    throw new Error(`--groups is required (one of ${METHOD_GROUPS.join(", ")})`);
  }
  for (const group of groups) {
    if (!METHOD_GROUPS.includes(group)) {
      throw new Error(`--groups ${JSON.stringify(group)} must be one of ${METHOD_GROUPS.join(", ")}`);
    }
  }
  return groups;
}

/**
 * `key=value,key=value` → object.
 *
 * Only `true`, `false`, `null` and safe integers are typed. A bank account number is a
 * string that happens to look like digits: turning it into a JavaScript number would
 * silently lose its last digits, which is a wrong invoice rather than a parsing quirk.
 */
export function parseSettings(raw) {
  if (raw === undefined) return undefined;
  const settings = {};
  for (const pair of [].concat(raw).flatMap((item) => String(item).split(","))) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const index = trimmed.indexOf("=");
    if (index <= 0) throw new Error(`--settings ${JSON.stringify(trimmed)} is not key=value`);
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (value === "true") settings[key] = true;
    else if (value === "false") settings[key] = false;
    else if (value === "null") settings[key] = null;
    else if (/^-?\d+$/.test(value) && Number.isSafeInteger(Number(value))) {
      settings[key] = Number(value);
    } else settings[key] = value;
  }
  return settings;
}

function connectionId(raw, command) {
  const id = String(raw ?? "").trim();
  if (!id) throw new Error(`${command} needs a connection id`);
  if (!UUID.test(id)) throw new Error(`${command}: ${JSON.stringify(id)} is not a connection id`);
  return id;
}

function reasonOf(flags, command, { required }) {
  const reason = one(flags, "reason");
  const text = reason === undefined ? null : String(reason).trim();
  if (required && !text) throw new Error(`${command} needs --reason "..." to record why`);
  return text || null;
}

function priorityOf(flags) {
  const raw = one(flags, "priority");
  if (raw === undefined) return undefined;
  const text = String(raw).trim();
  if (!PRIORITY.test(text)) throw new Error("--priority must be a non-negative integer");
  const value = Number(text);
  if (!Number.isSafeInteger(value)) throw new Error("--priority is too large");
  return value;
}

/**
 * The address the provider posts to.
 *
 * The provider calls the application origin, and the web container proxies `/api/` to
 * the service: the service's own route (`/billing/webhooks/…`) is not reachable from
 * outside without that prefix. A URL without it lands in the app's fallback page, which
 * answers 200 and applies nothing — the most silent failure a payment can have.
 */
export function webhookUrlFor(origin, connection) {
  const base = String(origin ?? "http://localhost:5173").replace(/\/$/, "");
  return `${base}/api/billing/webhooks/${connection.id}/${connection.webhookToken}`;
}

/** `--as` exactly as typed; empty is a typo, not a fallback. */
function actorFlag(flags) {
  const value = flags.has("as") ? String(flags.get("as")).trim() : null;
  if (value === "") throw new Error("--as needs an operator id or email address");
  return value;
}

/**
 * Parse one command line into a plain object, or `{ help: true }`. No environment, no
 * database: every refusal below is an operator typo that must stop before a row exists.
 */
export function parseProviderArgs(argv) {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    return { help: true };
  }
  const [command, ...rest] = argv;
  const { flags, positionals } = readFlags(rest, new Set(["activate"]));

  if (command === "list") {
    rejectUnknown(flags, [], "list");
    if (positionals.length > 0) throw new Error(`list does not take ${positionals[0]}`);
    return { command };
  }

  if (command === "create") {
    rejectUnknown(
      flags,
      [
        "provider",
        "mode",
        "currency",
        "groups",
        "name",
        "priority",
        "settings",
        "secret-file",
        "activate",
        "as",
      ],
      "create",
    );
    if (positionals.length > 0) throw new Error(`create does not take ${positionals[0]}`);
    const provider = String(one(flags, "provider") ?? "").trim();
    if (!PROVIDERS.includes(provider)) {
      throw new Error(`--provider must be one of ${PROVIDERS.join(", ")}`);
    }
    const mode = String(one(flags, "mode") ?? "test").trim();
    if (!MODES.includes(mode)) throw new Error(`--mode must be one of ${MODES.join(", ")}`);
    const name = String(one(flags, "name") ?? "").trim();
    if (!name) throw new Error("--name is required: the operator label of this connection");
    return {
      command,
      provider,
      mode,
      name,
      currencies: currencyList(flags, { required: true }),
      methodGroups: groupList(flags, { required: true }),
      priority: priorityOf(flags) ?? 100,
      settings: parseSettings(flags.get("settings")) ?? {},
      secretFile: one(flags, "secret-file") ? String(one(flags, "secret-file")) : null,
      activate: flags.has("activate"),
      as: actorFlag(flags),
    };
  }

  if (command === "set") {
    rejectUnknown(flags, ["priority", "currency", "groups", "settings", "as"], "set");
    const id = connectionId(positionals[0], "set");
    if (positionals.length > 1) throw new Error("set takes one connection id");
    const currencies = currencyList(flags, { required: false });
    const methodGroups = groupList(flags, { required: false });
    const settings = parseSettings(flags.get("settings"));
    const priority = priorityOf(flags);
    if (
      priority === undefined &&
      currencies.length === 0 &&
      methodGroups.length === 0 &&
      settings === undefined
    ) {
      throw new Error("set needs at least one of --priority, --currency, --groups, --settings");
    }
    return {
      command,
      id,
      priority,
      currencies: currencies.length > 0 ? currencies : undefined,
      methodGroups: methodGroups.length > 0 ? methodGroups : undefined,
      settings,
      as: actorFlag(flags),
    };
  }

  if (command === "verify") {
    rejectUnknown(flags, [], "verify");
    const id = connectionId(positionals[0], "verify");
    if (positionals.length > 1) throw new Error("verify takes one connection id");
    return { command, id };
  }

  if (command === "secret") {
    rejectUnknown(flags, ["secret-file", "reason", "as"], "secret");
    const id = connectionId(positionals[0], "secret");
    // A second value would be a key typed into the shell, which is the thing this
    // command exists to avoid. Refuse it explicitly instead of ignoring it.
    if (positionals.length > 1) {
      throw new Error("secret takes one connection id: the key comes from --secret-file or a prompt");
    }
    return {
      command,
      id,
      secretFile: one(flags, "secret-file") ? String(one(flags, "secret-file")) : null,
      reason: reasonOf(flags, "secret", { required: false }),
      as: actorFlag(flags),
    };
  }

  if (Object.hasOwn(STATUS_COMMANDS, command)) {
    const spec = STATUS_COMMANDS[command];
    rejectUnknown(flags, ["reason", "as"], command);
    const id = connectionId(positionals[0], command);
    if (positionals.length > 1) throw new Error(`${command} takes one connection id`);
    return {
      command,
      id,
      to: spec.to,
      reason: reasonOf(flags, command, { required: spec.needsReason }),
      as: actorFlag(flags),
    };
  }

  if (command === "webhook-url") {
    rejectUnknown(flags, [], "webhook-url");
    const id = connectionId(positionals[0], "webhook-url");
    if (positionals.length > 1) throw new Error("webhook-url takes one connection id");
    return { command, id };
  }

  throw new Error(`unknown command ${JSON.stringify(command)}`);
}

/**
 * Adapters are imported statically: a template-literal `import()` makes the test runner
 * rewrite this file and collide with the shebang. Adding a provider is one entry here
 * plus its `pay-<provider>.mjs`, which is the same one-file rule the ADR states.
 */
const ADAPTERS = Object.freeze({
  manual: () => import("../apps/sync/pay-manual.mjs"),
  yookassa: () => import("../apps/sync/pay-yookassa.mjs"),
});

async function loadAdapter(provider) {
  // The fake adapter is imported here, not at module load: `.env` is read just before
  // `main` runs, so a flag placed there must still be able to select the development
  // provider without turning it into a production import.
  const load =
    provider === "fake"
      ? fakeProviderEnabled()
        ? () => import("../apps/sync/pay-fake.mjs")
        : null
      : ADAPTERS[provider];
  if (!load) {
    throw new Error(
      provider === "fake"
        ? "the fake provider is for development only: run with NODE_ENV!=production and REMO_PAY_FAKE=1"
        : `provider ${provider} has no adapter yet (apps/sync/pay-${provider}.mjs)`,
    );
  }
  const module = await load();
  return module.default ?? module[`${provider}Adapter`];
}

async function readSecretFile(path) {
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    throw new Error(`--secret-file: cannot read ${path} (${error.code ?? error.message})`);
  }
  return parseSecretText(text, "--secret-file");
}

function parseSecretText(text, source) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${source} must contain one JSON object`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${source} must contain one JSON object`);
  }
  return parsed;
}

/**
 * The key never appears on screen, in the shell history or in the process list.
 *
 * Raw mode turns the terminal's own echo off; the characters are collected here and only
 * the parsed object leaves this function. A pipeline cannot answer a hidden prompt, so
 * `--secret-file` is the only non-interactive path — deliberately, not as an oversight.
 */
export async function readSecretFromTerminal({
  input = process.stdin,
  output = process.stderr,
  prompt = "secret JSON (not echoed): ",
} = {}) {
  if (!input.isTTY) {
    throw new Error(
      "secret needs a terminal: type it at the prompt, or pass --secret-file <json> from a file only its owner can read",
    );
  }
  const wasRaw = Boolean(input.isRaw);
  output.write(prompt);
  const text = await new Promise((resolve, reject) => {
    let typed = "";
    const finish = (error, value) => {
      input.off("data", onData);
      input.setRawMode(wasRaw);
      input.pause();
      output.write("\n");
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk) => {
      for (const char of String(chunk)) {
        if (char === "\r" || char === "\n") {
          finish(null, typed);
          return;
        }
        if (char === "\u0003") {
          finish(new Error("cancelled at the prompt; the secret was not changed"));
          return;
        }
        if (char === "\u007f" || char === "\b") {
          typed = typed.slice(0, -1);
          continue;
        }
        typed += char;
      }
    };
    input.setRawMode(true);
    input.resume();
    input.on("data", onData);
  });
  if (!text.trim()) throw new Error("no secret was entered; nothing was changed");
  return parseSecretText(text, "the prompted secret");
}

/** The KEK is read only by a command that really seals or opens a secret. */
function requireKek() {
  const kek = kekFromEnv();
  if (!kek) {
    throw new Error(
      "REMO_KEK is required (32 bytes, base64) to open or seal a connection secret; see docs/self-hosting",
    );
  }
  return kek;
}

/** The connection as an adapter sees it: public fields plus the opened secret. */
function withOpenSecret(connection, kek) {
  if (!connection.has_secret) return { ...connection, secret: {} };
  return { ...connection, secret: openConnectionSecret(connection, { kek }) };
}


function openStore() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required: connections live in Postgres");
  }
  return new PostgresStore({
    connectionString,
    migrationConnectionString: process.env.REMO_MIGRATION_DATABASE_URL ?? connectionString,
    log: console,
  });
}

function printConnection(row, { webhookUrl = null } = {}) {
  const secret = row.has_secret ? `secret ${row.secret_fingerprint ?? "?"}` : "no secret";
  console.log(
    `${row.id}  ${row.provider}/${row.mode}  ${row.status.padEnd(8)}  ` +
      `priority ${String(row.priority).padStart(3)}  ${row.currencies.join(",")}  ` +
      `${row.methodGroups.join(",")}  ${secret}`,
  );
  if (row.lastHealthError) console.log(`  last health: ${row.lastHealthError}`);
  if (webhookUrl) console.log(webhookUrl);
}

async function main(argv) {
  const args = parseProviderArgs(argv);
  if (args.help) {
    console.log(PROVIDER_USAGE);
    return;
  }
  // A stand never gets a live connection (`spec/stage.md` §5). Refused before the
  // database is opened, so a half-created row cannot exist.
  if (args.command === "create") assertLiveBillingAllowed(args.mode);
  const writes = ["create", "set", "secret", ...Object.keys(STATUS_COMMANDS)].includes(args.command);
  const actorValue = writes ? requireOperatorActorValue(args.as) : null;

  const store = openStore();
  await store.connect();
  try {
    const actor = actorValue ? await requireOperatorActor(store, actorValue) : null;
    if (args.command === "list") {
      const rows = await store.listConnections();
      if (rows.length === 0) {
        console.log("[billing:providers] no connections yet; create one with `billing-providers create ...`");
        return;
      }
      for (const row of rows) printConnection(row);
      return;
    }

    if (args.command === "create") {
      if (args.provider === "fake" && !fakeProviderEnabled()) {
        throw new Error(
          "the fake provider is for development only: run with NODE_ENV!=production and REMO_PAY_FAKE=1",
        );
      }
      if (args.provider === "manual" && args.secretFile) {
        throw new Error("manual needs no secret; refuse to store an unused key");
      }
      if (args.provider !== "manual" && !args.secretFile) {
        throw new Error(`${args.provider} needs --secret-file; a key is never passed as a flag`);
      }
      const adapter = await loadAdapter(args.provider);
      const secret = args.secretFile ? await readSecretFile(args.secretFile) : {};
      const problems = adapter.validateConfig(args.settings, secret);
      for (const problem of problems) {
        console.warn(`[billing:providers] warning: ${problem.field}: ${problem.message}`);
      }

      // A key that cannot reach the shop still creates the row, but it must not be
      // activated: the first payer would discover the problem instead of the operator.
      const probe =
        args.provider === "manual"
          ? { ok: true, detail: "manual: no provider API to check" }
          : await adapter.healthCheck({ provider: args.provider, settings: args.settings, secret });

      const id = randomUUID();
      let sealed = null;
      if (args.secretFile) {
        const text = JSON.stringify(secret);
        // The AAD binds the envelope to this id, provider and scope; the plaintext is
        // dropped with this block and never printed.
        sealed = {
          ...encryptSecret(text, { scope: "connection", scopeId: id, provider: args.provider, id, kek: requireKek() }),
          fingerprint: fingerprintSecret(text),
        };
      }

      const created = await store.createConnection({
        id,
        provider: args.provider,
        name: args.name,
        mode: args.mode,
        currencies: args.currencies,
        methodGroups: args.methodGroups,
        priority: args.priority,
        settings: args.settings,
        sealed,
        createdBy: actor.id,
      });
      await store.recordAudit({
        actorId: actor.id,
        action: "billing.provider_created",
        subject: created.id,
        after: { provider: created.provider, mode: created.mode, currencies: created.currencies },
        reason: "payment connection created from the operator's shell",
      });
      console.log(`[billing:providers] created ${created.id} (${created.status})`);
      if (args.provider !== "manual") {
        await store.setConnectionHealth(created.id, {
          ok: probe.ok,
          error: probe.ok ? null : probe.detail,
        });
      }
      let result = created;
      if (!probe.ok) {
        // No --activate, no status change: the row stays `draft` and the exit code says
        // the connection is not usable yet.
        console.error(`[billing:providers] health check failed: ${probe.detail}`);
        console.error(
          "[billing:providers] the connection stays draft; fix the keys with `secret` and run `verify`",
        );
        process.exitCode = 1;
      } else if (args.activate) {
        result = await store.setConnectionStatus(created.id, {
          from: "draft",
          to: "active",
          reason: args.provider === "manual" ? "activated at creation; manual needs no verify" : "activated at creation",
        });
        await store.recordAudit({
          actorId: actor.id,
          action: "billing.provider_activated",
          subject: result.id,
          after: { status: result.status },
          reason: "payment connection activated at creation",
        });
        console.log(`[billing:providers] ${result.id} is ${result.status}`);
      }
      printConnection(result);
      return;
    }

    if (args.command === "set") {
      const updated = await store.updateConnectionSettings(args.id, {
        priority: args.priority,
        settings: args.settings,
        currencies: args.currencies,
        methodGroups: args.methodGroups,
        reason: "operator set",
      });
      await store.recordAudit({
        actorId: actor.id,
        action: "billing.provider_updated",
        subject: updated.id,
        after: { priority: updated.priority, currencies: updated.currencies },
        reason: "payment connection settings changed from the operator's shell",
      });
      console.log("[billing:providers] updated");
      printConnection(updated);
      return;
    }

    if (args.command === "verify") {
      const connection = await store.connectionById(args.id);
      if (!connection) throw new Error(`connection ${args.id} does not exist`);
      const adapter = await loadAdapter(connection.provider);
      const conn = withOpenSecret(connection, connection.has_secret ? requireKek() : null);
      const health = await adapter.healthCheck(conn);
      // A probe is a fact about the connection, not a lifecycle event: the status stays
      // exactly as it was. `list` shows the answer in `last health`.
      await store.setConnectionHealth(connection.id, {
        ok: health.ok,
        error: health.ok ? null : health.detail,
      });
      if (!health.ok) {
        console.error(`[billing:providers] ${connection.id} failed: ${health.detail}`);
        process.exitCode = 1;
        return;
      }
      console.log(`[billing:providers] ${connection.id} ok: ${health.detail}`);
      return;
    }

    if (args.command === "secret") {
      const connection = await store.connectionById(args.id);
      if (!connection) throw new Error(`connection ${args.id} does not exist`);
      if (connection.provider === "manual") {
        throw new Error("manual needs no secret; refuse to store an unused key");
      }
      const adapter = await loadAdapter(connection.provider);
      const secret = args.secretFile ? await readSecretFile(args.secretFile) : await readSecretFromTerminal();
      const problems = adapter.validateConfig(connection.settings, secret);
      if (problems.length > 0) {
        // Rotating to an incomplete secret would break a connection that works today.
        for (const problem of problems) {
          console.error(`[billing:providers] ${problem.field}: ${problem.message}`);
        }
        throw new Error("the secret is incomplete; nothing was changed");
      }
      const text = JSON.stringify(secret);
      const reason = args.reason ?? "connection secret rotated from the operator's shell";
      const updated = await store.rotateConnectionSecret(
        connection.id,
        {
          ...encryptSecret(text, {
            scope: "connection",
            scopeId: connection.id,
            provider: connection.provider,
            id: connection.id,
            kek: requireKek(),
          }),
          fingerprint: fingerprintSecret(text),
        },
        { reason, actorId: actor.id },
      );
      await store.recordAudit({
        actorId: actor.id,
        action: "billing.provider_secret_rotated",
        subject: updated.id,
        after: { fingerprint: updated.secret_fingerprint },
        reason,
      });
      console.log(
        `[billing:providers] rotated ${updated.id}; secret ${updated.secret_fingerprint ?? "?"}`,
      );
      const health = await adapter.healthCheck({ ...updated, secret });
      await store.setConnectionHealth(updated.id, {
        ok: health.ok,
        error: health.ok ? null : health.detail,
      });
      if (!health.ok) {
        console.error(`[billing:providers] health check failed: ${health.detail}`);
        process.exitCode = 1;
        return;
      }
      console.log(`[billing:providers] ${updated.id} ok: ${health.detail}`);
      printConnection(updated);
      return;
    }

    if (Object.hasOwn(STATUS_COMMANDS, args.command)) {
      const current = await store.connectionById(args.id);
      if (!current) throw new Error(`connection ${args.id} does not exist`);
      if (!STATUS_COMMANDS[args.command].from.includes(current.status)) {
        throw new Error(
          `cannot ${args.command} a connection that is ${current.status}; ` +
            `allowed from ${STATUS_COMMANDS[args.command].from.join(", ")}`,
        );
      }
      if (args.command === "disable") {
        const live = await store.liveSubscriptionsForConnection(args.id);
        if (live.length > 0) {
          const list = live
            .map((row) => `${row.org_id} (${row.plan}, ${row.status}, until ${row.current_period_end?.toISOString?.() ?? row.current_period_end})`)
            .join("\n  ");
          throw new Error(
            `refusing to disable ${args.id}: ${live.length} live subscription(s) renew through it\n  ${list}\n` +
              "retire it and move the payers to another connection first",
          );
        }
      }
      const updated = await store.setConnectionStatus(args.id, {
        from: current.status,
        to: args.to,
        reason: args.reason,
      });
      await store.recordAudit({
        actorId: actor.id,
        action: "billing.provider_status_changed",
        subject: updated.id,
        before: { status: current.status },
        after: { status: updated.status },
        reason: args.reason ?? `${args.command} from the operator's shell`,
      });
      console.log(`[billing:providers] ${updated.id} is ${updated.status}`);
      printConnection(updated);
      return;
    }

    if (args.command === "webhook-url") {
      const connection = await store.connectionById(args.id);
      if (!connection) throw new Error(`connection ${args.id} does not exist`);
      console.log(webhookUrlFor(process.env.REMO_APP_ORIGIN, connection));
    }
  } finally {
    await store.close().catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.loadEnvFile?.(join(ROOT, ".env"));
  } catch {
    /* the process environment is the source of truth */
  }
  main(process.argv.slice(2)).catch((error) => {
    console.error(`[billing:providers] ${error.message}`);
    process.exitCode = 1;
  });
}
