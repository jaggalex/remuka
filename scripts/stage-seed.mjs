#!/usr/bin/env node
/**
 * `pnpm stage:seed` (ADR-261, `spec/stage.md` §6).
 *
 * Thin wrapper: the fixtures live in `apps/sync/stage-seed.mjs` so `stage:reset` calls
 * exactly the same seed and a test can run it without a child process.
 */
import { seedFromEnvironment } from "../apps/sync/stage-seed.mjs";
import { loadStageEnvironment } from "./stage-env.mjs";

loadStageEnvironment();

try {
  await seedFromEnvironment();
} catch (error) {
  console.error(`[stage:seed] ${error?.message ?? error}`);
  process.exitCode = 1;
}
