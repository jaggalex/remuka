#!/usr/bin/env node
/**
 * `pnpm billing:grant` (ADR-247, `spec/billing.md` §2.1, §2.4).
 *
 *   pnpm billing:grant --org <id> --plan team --until 2027-03-01 [--currency RUB] [--price <id>]
 *   pnpm billing:grant --org <id> --end
 *
 * The command body lives in `apps/sync/operator-billing-grant.mjs` so the console's plan
 * action and this script run the same code (ADR-262 §3). This file only loads the
 * environment and passes the arguments.
 */
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runBillingGrant } from "../apps/sync/operator-billing-grant.mjs";

export { GRANT_USAGE, parseGrantArgs, parseUntil } from "../apps/sync/operator-billing-grant.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.loadEnvFile?.(join(ROOT, ".env"));
  } catch {
    /* the process environment is the source of truth */
  }
  process.exitCode = await runBillingGrant({ argv: process.argv.slice(2) });
}
