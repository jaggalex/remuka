#!/usr/bin/env node
/**
 * One command that answers "can this be shipped?" (ADR-089).
 *
 * The order is deliberate: the dedicated test environment first, because a missing or
 * mismatched test server is the failure that used to hide behind a green run; then
 * typecheck; then the full test suite with DB suites enabled; then build, docs and the
 * design system. The preflight never uses the development database (ADR-136).
 *
 * `brand` sits next to `state` and `ui rules`: they are cheap text gates that fail before a
 * compiler or a browser does (ADR-254). `links` is one of them: the guide's address comes
 * from the installation, never from the build (ADR-284). `consent` is the same kind of gate: it reads the code
 * and the browser-storage registry together (ADR-255). `legal` checks the registry of legal
 * documents: a published revision may not change or still carry placeholders (ADR-256).
 *
 *   pnpm verify            the gate
 *   pnpm verify --e2e      the gate plus browser acceptance (ADR-090); the 10 000-object
 *                          scale budget is a separate nightly/labelled run
 *   pnpm verify --fast     skip the database preflight for the inner loop
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const args = new Set(process.argv.slice(2));
const fast = args.has("--fast");
const withE2e = args.has("--e2e");
const keepGoing = args.has("--keep-going");

const env = { ...process.env };
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

const steps = [];
if (!fast) {
  // The test environment is a separate server (ADR-136). This check never touches the
  // development database and never falls back to DATABASE_URL or .env.
  steps.push({ name: "test environment", cmd: "node", args: ["scripts/test-db-check.mjs"] });
} else {
  console.warn(
    "[verify] --fast: the test-environment preflight is skipped; DB suites need a running test server.",
  );
}
steps.push(
  { name: "file sizes", cmd: pnpm, args: ["size:check"] },
  { name: "state", cmd: "node", args: ["scripts/state-report.mjs"] },
  { name: "brand", cmd: "node", args: ["scripts/brand-check.mjs"] },
  { name: "links", cmd: "node", args: ["scripts/links-check.mjs"] },
  { name: "consent", cmd: "node", args: ["scripts/consent-check.mjs"] },
  { name: "legal", cmd: "node", args: ["scripts/legal-build.mjs", "--check"] },
  { name: "ui rules", cmd: "node", args: ["scripts/ui-rules-check.mjs"] },
  { name: "typecheck", cmd: pnpm, args: ["typecheck"] },
  { name: "lint", cmd: pnpm, args: ["lint"] },
  { name: "hint slots", cmd: "node", args: ["scripts/hint-slots.mjs", "--check"] },
  { name: "tests", cmd: pnpm, args: ["test"] },
);
if (withE2e) {
  // `perf-scale.spec.ts` is excluded by `playwright.config.ts`: a shared runner is noisy
  // against the 16 ms budget. It runs via `pnpm e2e:perf-scale`, the `perf` label or the
  // nightly `perf` workflow, not in front of every PR.
  steps.push({ name: "e2e", cmd: pnpm, args: ["e2e"] });
  steps.push({
    name: "billing e2e",
    cmd: pnpm,
    args: ["e2e", "--billing", "e2e/billing.spec.ts"],
  });
  steps.push({
    name: "plan changes e2e",
    cmd: pnpm,
    // The change fixture seeds a price book; the other spec needs an empty one.
    args: ["e2e", "--billing", "e2e/billing-plan-change.spec.ts"],
  });
  steps.push({ name: "hint publication", cmd: pnpm, args: ["hints:e2e"] });
  // Baselines are compared only in the Linux browser container (ADR-222).
  steps.push({ name: "visual", cmd: pnpm, args: ["e2e:visual"] });
  // The guide audit reads `docs-site/`; a clean checkout has no generated output yet.
  // Build it first, then audit; `guide:check` below still catches a stale source tree.
  steps.push({ name: "guide build", cmd: pnpm, args: ["guide:build"] });
  // The guide has its own browser checks: layout, anchors, focus, theme, copy, search.
  steps.push({ name: "guide audit", cmd: pnpm, args: ["guide:audit"] });
}
steps.push(
  { name: "build", cmd: pnpm, args: ["build"] },
  { name: "docs", cmd: pnpm, args: ["docs:check"] },
  { name: "guide", cmd: pnpm, args: ["guide:check"] },
  { name: "design system", cmd: pnpm, args: ["ds:check"] },
);

const results = [];
const startedAll = Date.now();

for (const step of steps) {
  process.stdout.write(`\n▶ ${step.name}\n`);
  const started = Date.now();
  const result = spawnSync(step.cmd, step.args, {
    cwd: ROOT,
    env,
    stdio: "inherit",
    shell: false,
  });
  const seconds = (Date.now() - started) / 1000;
  const ok = result.status === 0;
  results.push({ ...step, seconds, ok });
  if (!ok && !keepGoing) break;
}

const total = ((Date.now() - startedAll) / 1000).toFixed(1);
console.log("\n── verify ─────────────────────────────────");
for (const result of results) {
  const mark = result.ok ? "ok  " : "FAIL";
  console.log(`${mark}  ${result.name.padEnd(16)} ${result.seconds.toFixed(1)}s`);
}
const skipped = steps.length - results.length;
if (skipped > 0) console.log(`      ${skipped} step(s) not run`);
console.log(`      total ${total}s\n`);

const failed = results.find((result) => !result.ok);
if (failed) {
  console.error(`VERIFY FAILED at "${failed.name}". Fix it and run pnpm verify again.`);
  process.exit(1);
}
console.log("VERIFY OK");
