#!/usr/bin/env node
/**
 * Mark an invoice paid by bank transfer (ADR-247, `spec/billing.md` §4, stage 2).
 *
 *   pnpm billing:mark-paid <invoiceId> --reason "..." [--ref <bank reference>] --as <operator>
 *
 * The command body lives in `apps/sync/operator-billing-paid.mjs` so the console's manual
 * payment action and this script run the same code (ADR-262 §3). This file only loads the
 * environment and passes the arguments.
 */
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runBillingMarkPaid } from "../apps/sync/operator-billing-paid.mjs";

export { MARK_PAID_USAGE, parseMarkPaidArgs } from "../apps/sync/operator-billing-paid.mjs";
export const runMarkPaid = runBillingMarkPaid;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.loadEnvFile?.(join(ROOT, ".env"));
  } catch {
    /* the process environment is the source of truth */
  }
  process.exitCode = await runMarkPaid({ argv: process.argv.slice(2) });
}
