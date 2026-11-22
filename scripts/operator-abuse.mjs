#!/usr/bin/env node
/**
 * `abuse:*`: measures against abuse from the operator's shell (ADR-259,
 * `spec/operator.md` §4).
 *
 *   pnpm abuse:link-disable --link <room-id>  --reason "..." --public "..."
 *   pnpm abuse:board-hide   --board <room-id> --reason "..." --public "..."
 *   pnpm abuse:org-suspend  --org <org-id>    --reason "..." --public "..."
 *   pnpm abuse:revert       <action-id>       --reason "..."
 *   pnpm abuse:list         [--open]
 *
 * The subcommand is the first argument; the package scripts add it. Every measure writes
 * `operator_actions` and letters the organisation's administrators with the reason and the
 * appeal address; nothing is applied when that letter cannot be queued. The command body
 * lives in `apps/sync/operator-abuse.mjs`.
 */
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runAbuse } from "../apps/sync/operator-abuse.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.loadEnvFile?.(join(ROOT, ".env"));
  } catch {
    /* the process environment is the source of truth */
  }
  const [command, ...argv] = process.argv.slice(2);
  process.exitCode = await runAbuse({
    command: command ?? "list",
    argv: command ? argv : [],
  });
}
