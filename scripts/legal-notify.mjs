#!/usr/bin/env node
/**
 * Tell every active account that a document got a new required revision (ADR-256 §5).
 *
 *   pnpm legal:notify --doc consent [--date YYYY-MM-DD] [--dry-run]
 *
 * Publishing is a file change, not a service event: the command exists so a letter goes
 * out when an operator decides it should, never at start and never twice by accident of a
 * restart. Each run queues one `legal_update` letter per active account in the
 * installation's zone; the outbox drain sends them. Repeating a run for the same document
 * queues a second letter, so the dry run is the check before the real one.
 *
 * The link is the public page of the document (`/legal/<doc>`), the date is the revision's
 * `effective` date — the day the acceptance window opens — and the letter only asks the
 * person to read it. Acceptance itself is an action after signing in, never a click in
 * mail. A document with `reaccept: false` needs no letter: a typo fix changes nothing for
 * the person.
 */
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { legalDocument, legalPageUrl, readLegalIndex } from "../packages/legal/src/index.mjs";
import { PostgresStore } from "../apps/sync/postgres.mjs";
import { resolveLegal } from "../apps/sync/legal.mjs";
import { formatEffective, noticePlan } from "../apps/sync/legal-notice.mjs";
import { assertMailConfig, enqueueMail, resolveMailConfig } from "../apps/sync/mail.mjs";

export { formatEffective, noticePlan };

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const USAGE = `usage: pnpm legal:notify --doc <document> [--date YYYY-MM-DD] [--dry-run]

Queues a legal_update letter for every active account of this installation's zone.
The document must exist in content/legal/index.json, be published (or the stand must set
REMO_LEGAL_ALLOW_DRAFTS=1) and have reaccept: true — a revision people do not accept
needs no letter. --date overrides the effective date printed in the letter.`;

export function parseNotifyArgs(argv) {
  const flags = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) throw new Error(`unexpected argument ${item}`);
    const name = item.slice(2);
    if (name === "dry-run") {
      flags.set(name, true);
      continue;
    }
    if (name !== "doc" && name !== "date") throw new Error(`legal:notify does not take --${name}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`--${name} needs a value`);
    flags.set(name, value);
    index += 1;
  }
  const doc = String(flags.get("doc") ?? "").trim();
  if (!doc) throw new Error("--doc is required");
  const date = flags.has("date") ? String(flags.get("date")).trim() : null;
  if (date !== null) {
    const parsed = new Date(`${date}T00:00:00Z`);
    if (!DATE.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
      throw new Error("--date must be a real YYYY-MM-DD date");
    }
  }
  return { doc, date, dryRun: Boolean(flags.get("dry-run")) };
}

/**
 * What would be sent: one item per active account, with the document title in that
 * person's language. Pure, so the command line and the test read the same plan.
 */

async function main(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE);
    return;
  }
  const options = parseNotifyArgs(argv);
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("[legal:notify] DATABASE_URL is required");
    process.exitCode = 1;
    return;
  }

  const legal = resolveLegal(process.env, { origin: process.env.REMO_APP_ORIGIN || undefined });
  if (legal.zone === "none") {
    console.error("[legal:notify] this installation has no zone and no documents");
    process.exitCode = 1;
    return;
  }
  const index = readLegalIndex(legal.root);
  const entry = legalDocument(index, legal.zone, options.doc);
  if (!entry) {
    console.error(`[legal:notify] ${legal.zone}/${options.doc} is not in content/legal/index.json`);
    process.exitCode = 1;
    return;
  }
  if (entry.reaccept !== true) {
    console.error(
      `[legal:notify] ${legal.zone}/${options.doc} has reaccept: false — a revision people do not accept needs no letter`,
    );
    process.exitCode = 1;
    return;
  }
  if (entry.status !== "published" && process.env.REMO_LEGAL_ALLOW_DRAFTS !== "1") {
    console.error(
      `[legal:notify] ${legal.zone}/${options.doc} is a draft; publish it or set REMO_LEGAL_ALLOW_DRAFTS=1 for a test stand`,
    );
    process.exitCode = 1;
    return;
  }
  const effective = options.date ?? entry.effective;
  if (!effective) {
    console.error("[legal:notify] the document has no effective date; pass --date YYYY-MM-DD");
    process.exitCode = 1;
    return;
  }

  const mailConfig = assertMailConfig(resolveMailConfig(process.env));
  if (mailConfig.driver === "disabled") {
    console.error("[legal:notify] mail is disabled; configure REMO_MAIL_DRIVER and REMO_MAIL_FROM");
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
    const users = await store.listActiveUsersForLegalNotice();
    const plan = noticePlan({
      document: entry.doc,
      title: entry.title ?? {},
      effective,
      users,
    });
    console.log(
      `[legal:notify] ${legal.zone}/${entry.doc} revision ${entry.current}, effective ${effective}: ${plan.length} active account(s)`,
    );
    if (options.dryRun) {
      for (const item of plan) console.log(`  would send to ${item.toEmail} (${item.locale})`);
      return;
    }
    for (const item of plan) {
      await enqueueMail(
        store,
        {
          userId: item.userId,
          toEmail: item.toEmail,
          template: "legal_update",
          locale: item.locale,
          params: item.params,
          // The document page is public, but the outbox seals every link it carries by
          // policy; a letter never keeps a clickable address in clear text.
          linkParams: { link: legalPageUrl(mailConfig.appOrigin, entry.doc) },
        },
        { config: mailConfig },
      );
    }
    await store.recordAudit({
      action: "legal.notify",
      subject: `${legal.zone}/${entry.doc}@v${entry.current}`,
      after: { recipients: plan.length, effective },
    });
    console.log(`[legal:notify] queued ${plan.length} letter(s)`);
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
