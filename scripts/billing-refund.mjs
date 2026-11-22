#!/usr/bin/env node
/**
 * `pnpm billing:refund` (ADR-259, `spec/billing.md` §4.3).
 *
 *   pnpm billing:refund <payment-id> [--amount <minor-units>] --reason "..."
 *
 * Returns the whole remaining sum or an explicit part, asks the connection's provider
 * first when it can refund, appends the ledger row, cancels a current-period subscription
 * on a full refund, writes the audit row and letters the payer. The command body lives in
 * `apps/sync/operator-billing.mjs`.
 */
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runBillingRefund } from "../apps/sync/operator-billing.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.loadEnvFile?.(join(ROOT, ".env"));
  } catch {
    /* the process environment is the source of truth */
  }
  process.exitCode = await runBillingRefund({ argv: process.argv.slice(2) });
}
