#!/usr/bin/env node
/**
 * `pnpm pulse:recompute` (`spec/pulse.md` §4.4).
 *
 * The same writer and advisory lock as the night: a manual recompute of a closed range,
 * used after a fix or a late event. The body lives in `apps/sync/pulse/cli.mjs`.
 */
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runPulseRecompute } from "../apps/sync/pulse/cli.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.loadEnvFile?.(join(ROOT, ".env"));
  } catch {
    /* the process environment is the source of truth */
  }
  process.exitCode = await runPulseRecompute({ argv: process.argv.slice(2) });
}
