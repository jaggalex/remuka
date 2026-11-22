#!/usr/bin/env node
/**
 * The operator role from the server shell (ADR-259, `spec/operator.md` §2).
 *
 *   pnpm operator:grant  --email ops@example.com --reason "bootstrap"
 *   pnpm operator:revoke --email ops@example.com --reason "left the team"
 *   pnpm operator:list
 *
 * Only this shell path changes `instance_operators`; the service has no route for it
 * (rule 1). Confirm the address in the app first: an unconfirmed account cannot hold the
 * role. The command body lives in `apps/sync/operator-role.mjs`.
 */
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runOperatorRole } from "../apps/sync/operator-role.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.loadEnvFile?.(join(ROOT, ".env"));
  } catch {
    /* the process environment is the source of truth */
  }
  const [command, ...argv] = process.argv.slice(2);
  process.exitCode = await runOperatorRole({
    command: command ?? "list",
    argv: command ? argv : [],
  });
}
