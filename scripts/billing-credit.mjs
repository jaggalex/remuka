#!/usr/bin/env node
/**
 * `pnpm billing:credit` (ADR-259, `spec/billing.md` §4.4).
 *
 *   pnpm billing:credit --org <organisation-id> --amount <minor-units> --reason "..."
 *
 * Adds a `goodwill` row to the credit journal; the next invoice applies it automatically.
 * The command body lives in `apps/sync/operator-billing.mjs`.
 */
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runBillingCredit } from "../apps/sync/operator-billing.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.loadEnvFile?.(join(ROOT, ".env"));
  } catch {
    /* the process environment is the source of truth */
  }
  process.exitCode = await runBillingCredit({ argv: process.argv.slice(2) });
}
