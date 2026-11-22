#!/usr/bin/env node
/**
 * Read one person's legal acceptances (ADR-256 §4).
 *
 *   pnpm legal:acceptances --user <user-id>
 *
 * An operator command, read-only by design: it answers a subject request or shows a
 * regulator which revision was accepted and when. It writes nothing, not even an audit
 * row — reading a journal is not a change to it. The address, when the installation keeps
 * one, is already an HMAC digest, so printing it is not printing an address.
 */
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PostgresStore } from "../apps/sync/postgres.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const USAGE = `usage: pnpm legal:acceptances --user <user-id>

Prints every acceptance of one account, oldest first: zone, document, revision, hash,
date, whether an address digest is kept, and the recorded user agent.
It only reads; it never writes a row.`;

/** One line per row, stable enough to diff between two answers. */
export function formatAcceptances(rows) {
  return (rows ?? []).map((row) => {
    const accepted = new Date(row.accepted_at).toISOString();
    const address = row.ip_hash ? "ip-digest" : "no-ip";
    const agent = row.user_agent ? ` agent=${row.user_agent}` : "";
    const event = row.event === "withdraw" ? "withdraw" : "accept";
    return `${accepted}  ${row.zone}/${row.doc} v${row.version}  sha256:${row.sha256}  ${event}  ${address}${agent}`;
  });
}

function argValue(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  const value = args[index + 1];
  return value && !value.startsWith("--") ? value : null;
}

async function main(argv) {
  const userId = argValue(argv, "--user");
  if (!userId) {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }
  if (!UUID.test(userId)) {
    console.error("[legal:acceptances] --user must be a user id (uuid)");
    process.exitCode = 1;
    return;
  }
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("[legal:acceptances] DATABASE_URL is required");
    process.exitCode = 1;
    return;
  }

  const store = new PostgresStore({
    connectionString,
    migrationConnectionString: process.env.REMO_MIGRATION_DATABASE_URL ?? connectionString,
    log: console,
  });
  try {
    await store.connect();
    const rows = await store.listLegalAcceptances(userId);
    if (!rows.length) {
      console.log(`[legal:acceptances] no acceptances for ${userId}`);
      return;
    }
    for (const line of formatAcceptances(rows)) console.log(line);
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
  await main(process.argv.slice(2));
}
