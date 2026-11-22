#!/usr/bin/env node
/**
 * `pnpm stage:reset --yes` (ADR-261, `spec/stage.md` §6).
 *
 * Thin wrapper: the destructive sequence lives in `apps/sync/stage-reset.mjs` so the
 * refusal without `REMO_STAGE=1` and the seed are ordinary code, not shell.
 */
import { resetFromArguments } from "../apps/sync/stage-reset.mjs";
import { loadStageEnvironment } from "./stage-env.mjs";

loadStageEnvironment();

try {
  await resetFromArguments();
} catch (error) {
  console.error(`[stage:reset] ${error?.message ?? error}`);
  process.exitCode = 1;
}
