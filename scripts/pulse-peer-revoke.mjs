#!/usr/bin/env node
/**
 * `pnpm pulse:peer:revoke` (`spec/pulse.md` §5.4): remove a peer's zone and journal it.
 *
 * Removing the origin from `REMO_PULSE_PEERS` alone is not a revoke — the rows stay and
 * the panel keeps drawing them. The command without the env change is useless — the next
 * collection brings the rows back. Both are required, and this is the half that removes.
 */
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runPulsePeerRevoke } from "../apps/sync/pulse/cli.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.loadEnvFile?.(join(ROOT, ".env"));
  } catch {
    /* the process environment is the source of truth */
  }
  process.exitCode = await runPulsePeerRevoke({ argv: process.argv.slice(2) });
}
