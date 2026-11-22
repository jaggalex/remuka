#!/usr/bin/env node
/**
 * `pnpm customer:show` (ADR-259, `spec/operator.md` §3).
 *
 *   pnpm customer:show --email person@example.com
 *   pnpm customer:show --org studio
 *
 * The support card: plan, subscription, invoices, payments, counts, accepted documents and
 * operator measures. Room names and content are never selected. The command body lives in
 * `apps/sync/operator-customer.mjs`.
 */
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runCustomerShow } from "../apps/sync/operator-customer.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.loadEnvFile?.(join(ROOT, ".env"));
  } catch {
    /* the process environment is the source of truth */
  }
  process.exitCode = await runCustomerShow({ argv: process.argv.slice(2) });
}
