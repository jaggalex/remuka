import base from "./playwright.config";

/**
 * The 10 000-object paint budget, apart from the PR gate.
 *
 * The ordinary `pnpm e2e` / `pnpm verify --e2e` ignores `perf-scale.spec.ts`: a shared
 * GitHub runner measured 17.3 ms against the 16 ms budget, while the same test passes on
 * a quiet host. The servers, database, ports and reporters are the base config; only the
 * file selection changes. Run it with `pnpm e2e:perf-scale`, the `perf` PR label or the
 * nightly `perf` workflow.
 */
export default {
  ...base,
  testMatch: "**/perf-scale.spec.ts",
  testIgnore: [],
};
