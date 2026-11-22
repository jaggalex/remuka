#!/usr/bin/env node
/**
 * `pnpm pulse:peer:list` (`spec/pulse.md` §5.3): the collector's state, read-only.
 */
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runPulsePeerList } from "../apps/sync/pulse/cli.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.loadEnvFile?.(join(ROOT, ".env"));
  } catch {
    /* the process environment is the source of truth */
  }
  process.exitCode = await runPulsePeerList({ argv: process.argv.slice(2) });
}
