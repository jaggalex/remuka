/**
 * The one browser the visual baselines are compared in (ADR-222).
 *
 * Chromium runs inside the official Playwright image, pinned to the version of
 * `@playwright/test`, as linux/amd64 on every machine, so a laptop and CI render the same
 * pixels. The tests stay on the host and connect over a websocket; the page reaches the
 * host's servers through Playwright's `exposeNetwork`.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";

const require = createRequire(import.meta.url);

export function playwrightVersion() {
  const path = require.resolve("@playwright/test/package.json");
  return JSON.parse(readFileSync(path, "utf8")).version;
}

export function linuxBrowserImage(version = playwrightVersion()) {
  return `mcr.microsoft.com/playwright:v${version}-noble`;
}

const docker = (args, options = {}) => spawnSync("docker", args, { encoding: "utf8", ...options });

async function waitForServer(port, container, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(2000) });
      if (response.ok && (await response.json()).wsEndpointPath === "/") return;
    } catch {
      // The published port may accept a connection before the server listens.
    }
    const state = docker(["inspect", "--format", "{{.State.Status}}", container]);
    if (state.stdout.trim() !== "running") throw new Error(`Linux browser container is ${state.stdout.trim() || "unavailable"}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`the Linux browser did not start on :${port} within ${timeoutMs / 1000}s`);
}

/** Start the container; returns the websocket endpoint and a stop function. */
export async function startLinuxBrowser({ port = 3790, name = `remo-linux-browser-${process.pid}` } = {}) {
  const version = playwrightVersion();
  const image = linuxBrowserImage(version);
  if (docker(["image", "inspect", image]).status !== 0) {
    throw new Error(`${image} is not pulled; run: docker pull --platform linux/amd64 ${image}`);
  }
  // Resolve through the actual dependency chain, including pnpm's isolated layout.
  const fromTest = createRequire(require.resolve("@playwright/test/package.json"));
  const fromRunner = createRequire(fromTest.resolve("playwright/package.json"));
  const core = fromRunner.resolve("playwright-core/package.json");
  if (fromRunner(core).version !== version) throw new Error(`playwright-core must match @playwright/test ${version}`);
  const directory = "/opt/remo-playwright-core";
  const created = docker([
    "create", "--init", "--platform", "linux/amd64",
    "--name", name, "-p", `127.0.0.1:${port}:3000`,
    "--workdir", "/home/pwuser", "--user", "pwuser",
    image, "node", `${directory}/cli.js`, "run-server", "--port", "3000", "--host", "0.0.0.0",
  ]);
  if (created.status !== 0) throw new Error(`docker create failed: ${created.stderr.trim()}`);
  const container = created.stdout.trim();
  const stop = () => {
    docker(["stop", "-t", "2", container]);
    return docker(["rm", "-f", container]);
  };
  try {
    // docker cp streams from the client: the daemon need not share its filesystem.
    // The standalone core package is root-owned and read-only to pwuser.
    const copied = docker(["cp", dirname(core), `${container}:${directory}`]);
    if (copied.status !== 0) throw new Error(`docker cp failed: ${copied.stderr.trim()}`);
    const started = docker(["start", container]);
    if (started.status !== 0) throw new Error(`docker start failed: ${started.stderr.trim()}`);
    await waitForServer(port, container, 180_000);
  } catch (error) {
    const logs = docker(["logs", container]);
    stop();
    throw new Error(`${error.message}\n${logs.stdout}${logs.stderr}`);
  }
  return { wsEndpoint: `ws://127.0.0.1:${port}/`, stop };
}
