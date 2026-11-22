#!/usr/bin/env node
/**
 * The end-to-end acceptance for the AI gateway (ADR-251, `spec/ai-gateway.md` §10):
 * sync's real client → the real gateway → a fake provider, all over HTTP.
 *
 * Why a script and not a Playwright scenario: `pnpm e2e` already starts three servers and
 * a database, and this acceptance needs two more containers, a certificate pair generated
 * per run, and a kill-switch dance that stops and starts the gateway. Bolting that onto
 * the browser run would make every unrelated scenario wait for Docker and fail when it is
 * missing. Here the cost is paid only by the command that asks for it.
 *
 * The three processes are the production ones: `apps/sync/ai.mjs` and
 * `apps/sync/agent-call.mjs` on the host, `apps/ai-gateway/server.mjs` in its container,
 * and an HTTPS OpenAI-shaped provider. Nothing in the gateway is stubbed or weakened: the
 * compose network gives the provider an address outside the ranges `@remo/outbound`
 * refuses, and the run's own CA is what both ends trust.
 *
 *   pnpm e2e:gateway             run, print a summary, remove the containers
 *   pnpm e2e:gateway --keep      leave the stack and the certificates for inspection
 */
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request as httpsRequest } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { AiClient, bindAiMetrics } from "../apps/sync/ai.mjs";
import { callAgentModel } from "../apps/sync/agent-call.mjs";
import { hashRun, normalizeRun } from "../apps/sync/ai-log.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const FILE = "docker-compose.test.yml";
const PROJECT = "remo-test";
const PROFILE = ["--profile", "ai"];
const PROVIDER = "fake";
const GATEWAY_PORT = Number(process.env.REMO_TEST_GATEWAY_PORT ?? 18080);
const PROVIDER_PORT = Number(process.env.REMO_TEST_PROVIDER_PORT ?? 18443);
const KEEP = process.argv.includes("--keep");

/** Per-run secrets: generated here, passed through the environment, never written down. */
const TOKENS = {
  gateway: randomBytes(24).toString("hex"),
  admin: randomBytes(24).toString("hex"),
  metrics: randomBytes(24).toString("hex"),
  provider: randomBytes(24).toString("hex"),
};

const CERT_DIR = mkdtempSync(join(tmpdir(), "remo-e2e-gateway-"));
const COMPOSE_ENV = {
  ...process.env,
  REMO_TEST_GATEWAY_CERTS: CERT_DIR,
  REMO_TEST_GATEWAY_PORT: String(GATEWAY_PORT),
  REMO_TEST_PROVIDER_PORT: String(PROVIDER_PORT),
  REMO_TEST_GATEWAY_TOKEN: TOKENS.gateway,
  REMO_TEST_GATEWAY_ADMIN_TOKEN: TOKENS.admin,
  REMO_TEST_GATEWAY_METRICS_TOKEN: TOKENS.metrics,
  REMO_TEST_PROVIDER_KEY: TOKENS.provider,
};

const CA_FILE = join(CERT_DIR, "ca.pem");
const MARKER = `e2e-prompt-marker-${randomBytes(6).toString("hex")}`;
const SYSTEM_PROMPT = "You are the acceptance-run agent. Answer with one JSON object.";
const USER_PROMPT = `Draw an empty diagram. ${MARKER}`;

/* ------------------------------------------------------------------ process --- */

function docker(args, { capture = false, allowFailure = false } = {}) {
  const result = spawnSync("docker", ["compose", "-p", PROJECT, "-f", FILE, ...PROFILE, ...args], {
    cwd: ROOT,
    env: COMPOSE_ENV,
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) {
    const detail = String(result.stderr || result.stdout || "").trim();
    throw new Error(`docker compose ${args.join(" ")} exited ${result.status}${detail ? `: ${detail}` : ""}`);
  }
  return result;
}

function openssl(args) {
  const result = spawnSync("openssl", args, { cwd: CERT_DIR, encoding: "utf8", stdio: "pipe" });
  if (result.error) throw new Error("openssl is required to prepare the run certificates");
  if (result.status !== 0) {
    throw new Error(`openssl ${args.join(" ")} failed: ${String(result.stderr).trim()}`);
  }
}

/**
 * A CA and two leaves: the provider's certificate names the compose service, the gateway's
 * names loopback because that is where sync reaches it. Two days is longer than a run and
 * shorter than anything worth keeping.
 */
function makeCertificates() {
  writeFileSync(
    join(CERT_DIR, "ca.cnf"),
    [
      "[req]",
      "distinguished_name = dn",
      "x509_extensions = v3_ca",
      "prompt = no",
      "[dn]",
      "CN = remo-e2e-ca",
      "[v3_ca]",
      "basicConstraints = critical,CA:TRUE",
      "keyUsage = critical,keyCertSign,cRLSign",
      "subjectKeyIdentifier = hash",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(CERT_DIR, "provider.ext"),
    [
      "basicConstraints = critical,CA:FALSE",
      "keyUsage = critical,digitalSignature,keyEncipherment",
      "extendedKeyUsage = serverAuth",
      "subjectAltName = DNS:fake-provider,DNS:localhost,IP:127.0.0.1",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(CERT_DIR, "gateway.ext"),
    [
      "basicConstraints = critical,CA:FALSE",
      "keyUsage = critical,digitalSignature,keyEncipherment",
      "extendedKeyUsage = serverAuth",
      "subjectAltName = DNS:localhost,IP:127.0.0.1",
      "",
    ].join("\n"),
  );

  openssl(["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2", "-config", "ca.cnf",
    "-keyout", "ca-key.pem", "-out", "ca.pem"]);
  for (const name of ["provider", "gateway"]) {
    openssl(["req", "-new", "-newkey", "rsa:2048", "-nodes", "-subj", `/CN=${name}`,
      "-keyout", `${name}-key.pem`, "-out", `${name}.csr`]);
    openssl(["x509", "-req", "-in", `${name}.csr`, "-CA", "ca.pem", "-CAkey", "ca-key.pem",
      "-CAcreateserial", "-days", "2", "-extfile", `${name}.ext`, "-out", `${name}.pem`]);
  }
}

// The CA is read below when the clients are configured, so the files must exist first.
try {
  makeCertificates();
} catch (error) {
  rmSync(CERT_DIR, { recursive: true, force: true });
  throw error;
}

/* --------------------------------------------------------------------- http --- */
/** HTTPS with an explicit CA: the global `fetch` cannot pin one per request. */
function httpsJson(url, { method = "GET", token = null, body = null, timeoutMs = 20_000 } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const payload = body === null ? null : Buffer.from(JSON.stringify(body));
    const request = httpsRequest(
      {
        hostname: target.hostname,
        port: target.port || 443,
        path: `${target.pathname}${target.search}`,
        method,
        ca: readFileSync(CA_FILE),
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(payload ? { "content-type": "application/json", "content-length": String(payload.length) } : {}),
        },
        timeout: timeoutMs,
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch {
            json = null;
          }
          resolve({ status: response.statusCode ?? 0, headers: response.headers, text, json });
        });
      },
    );
    request.on("timeout", () => request.destroy(new Error(`no answer within ${timeoutMs} ms`)));
    request.on("error", reject);
    if (payload) request.write(payload);
    request.end();
  });
}

const gatewayUrl = `https://127.0.0.1:${GATEWAY_PORT}`;
const providerUrl = `https://127.0.0.1:${PROVIDER_PORT}`;

async function waitForHealth(url, label, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    try {
      const answer = await httpsJson(`${url}/healthz`, { timeoutMs: 2_000 });
      if (answer.status === 200 && answer.json?.status === "ok") return;
      last = `status ${answer.status}`;
    } catch (error) {
      last = String(error?.message ?? error);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${label} did not become healthy: ${last}`);
}

async function providerStats() {
  const answer = await httpsJson(`${providerUrl}/__stats`);
  if (answer.status !== 200) throw new Error(`provider stats: status ${answer.status}`);
  return answer.json;
}

/* --------------------------------------------------------------- assertions --- */

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function equal(actual, expected, what) {
  if (actual !== expected) {
    throw new Error(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

/** Run a call that must fail and return the error, whichever layer produced it. */
async function failureOf(call) {
  try {
    await call();
  } catch (error) {
    return error;
  }
  throw new Error("the call succeeded, but the run expected a failure");
}

/** A counter value from a Prometheus text body, matching labels as a subset. */
function counter(text, name, labels) {
  let total = 0;
  for (const line of text.split("\n")) {
    if (!line.startsWith(`${name}{`) && !line.startsWith(`${name} `)) continue;
    const matched = Object.entries(labels).every(([key, value]) => line.includes(`${key}="${value}"`));
    if (!matched) continue;
    total += Number(line.slice(line.lastIndexOf(" ") + 1)) || 0;
  }
  return total;
}

/* --------------------------------------------------------------- sync wiring --- */

const CA_PEM = readFileSync(CA_FILE, "utf8");
const SYNC_ENV = {
  REMO_AI_GATEWAY_URL: gatewayUrl,
  REMO_AI_GATEWAY_TOKEN: TOKENS.gateway,
  REMO_AI_GATEWAY_TIMEOUT_MS: "10000",
  REMO_AI_GATEWAY_CA: CA_PEM,
  REMO_AI_REGION: "eu",
  // The BYOK/custom base URL sync sends as `X-Remo-Upstream`; the registry matches it.
  REMO_AI_BASE_URL: "https://fake-provider:8443",
  REMO_AI_MODEL: "fake-model",
};
const GATEWAY = {
  url: gatewayUrl,
  token: TOKENS.gateway,
  timeoutMs: 10_000,
  region: "eu",
  ca: CA_PEM,
};

const ORG_ID = "org-e2e";
const USER_ID = "user-e2e";
const TASK = {
  id: "task-e2e",
  org_id: ORG_ID,
  agent_id: "agent-e2e",
  board_id: "board-e2e",
  model: null,
  credential_id: null,
};
const AGENT = { owner_id: USER_ID, credential_id: null, model: null };
const SKILL = { slug: "diagram", version: 1, tools: [] };
const PROMPT = { system: SYSTEM_PROMPT, user: USER_PROMPT };
const BUDGET = { maxTokens: 4000 };

/** `callAgentModel` only needs the journal, so the row it writes can be read here. */
function recordingStore(runs) {
  return {
    async getAiPolicy() {
      return null;
    },
    async getAiCredential() {
      return null;
    },
    async getDefaultAiCredential() {
      return null;
    },
    async touchAiCredential() {},
    async appendAiRun(row) {
      runs.push(row);
    },
  };
}

/** The process-wide registry `server.mjs` binds once; `inc` is all `ai.mjs` uses. */
function metricsRecorder() {
  const counters = new Map();
  return {
    inc(name, labels = {}, value = 1) {
      const key = `${name}${JSON.stringify(labels)}`;
      counters.set(key, (counters.get(key) ?? 0) + value);
    },
    unavailable() {
      let total = 0;
      for (const [key, value] of counters) {
        if (key.startsWith("remo_ai_gateway_unavailable_total")) total += value;
      }
      return total;
    },
  };
}

function agentCall(store) {
  return callAgentModel({
    store,
    task: TASK,
    agent: AGENT,
    skill: SKILL,
    prompt: PROMPT,
    budget: BUDGET,
    env: SYNC_ENV,
  });
}

/* ------------------------------------------------------------------ scenario --- */

const steps = [];

async function step(name, run) {
  process.stdout.write(`\n▶ ${name}\n`);
  const started = Date.now();
  try {
    await run();
    steps.push({ name, ok: true, ms: Date.now() - started });
    process.stdout.write(`  ok (${Date.now() - started} ms)\n`);
  } catch (error) {
    steps.push({ name, ok: false, ms: Date.now() - started, error });
    throw error;
  }
}

async function scenario() {
  const metrics = metricsRecorder();
  bindAiMetrics(metrics);
  const runs = [];
  const store = recordingStore(runs);

  await step("the fake provider and the gateway answer on their loopback ports", async () => {
    const provider = await httpsJson(`${providerUrl}/healthz`);
    equal(provider.status, 200, "provider healthz status");
    equal(provider.json?.status, "ok", "provider healthz body");
    await waitForHealth(gatewayUrl, "the gateway", 30_000);
  });

  await step("the gateway refuses a wrong sync token", async () => {
    const answer = await httpsJson(`${gatewayUrl}/v1/chat/completions`, {
      method: "POST",
      token: "not-the-shared-token",
      body: { model: "fake-model", messages: [{ role: "user", content: "hi" }] },
    });
    equal(answer.status, 401, "bad-token status");
    equal(answer.json?.error?.code, "GATEWAY_AUTH", "bad-token code");
  });

  await step("an agent task goes through the gateway and is journaled with the provider", async () => {
    const result = await agentCall(store);
    equal(result.completion.gatewayProvider, "fake", "answering provider");
    equal(result.completion.json?.note, "fake-provider", "answer body");
    equal(result.completion.usage.promptTokens, 11, "prompt tokens");
    equal(result.completion.requestId, "fake-1", "provider request id");
    equal(runs.length, 1, "journal rows");
    equal(runs[0].provider, "gateway", "journal provider");
    equal(runs[0].gatewayProvider, "fake", "ai_runs.gateway_provider");
    // The value is part of the canonical, hashed record (schema 27), not a side field.
    equal(normalizeRun(runs[0]).gatewayProvider, "fake", "hashed gateway provider");
    equal(hashRun(normalizeRun(runs[0])).length, 64, "journal row hash");
    equal(runs[0].status, "ok", "journal status");
    equal(runs[0].errorCode, null, "journal error code");
  });

  await step("the provider received only the installation key and no X-Remo headers", async () => {
    const stats = await providerStats();
    equal(stats.requests, 1, "provider requests");
    equal(stats.last.model, "fake-model", "model sent upstream");
    equal(stats.last.remoHeaders.length, 0, `X-Remo headers forwarded: ${stats.last.remoHeaders.join(", ")}`);
    const expected = createHash("sha256").update(TOKENS.provider).digest("hex").slice(0, 12);
    equal(stats.last.keyFingerprint, expected, "provider key fingerprint");
  });

  await step("a provider id works as X-Remo-Upstream as well as a matched base URL", async () => {
    const client = new AiClient({ model: "fake-model", gateway: GATEWAY, gatewayCa: CA_PEM, log: { error() {} } });
    const answer = await client.chatJson({
      user: "second call",
      maxTokens: 64,
      gateway: { upstream: "fake", orgId: ORG_ID, userId: USER_ID, taskId: "task-e2e-2" },
    });
    equal(answer.gatewayProvider, "fake", "provider id addressing");
  });

  await step("the gateway counts the calls in its own metrics", async () => {
    const answer = await httpsJson(`${gatewayUrl}/metrics`, { token: TOKENS.metrics });
    equal(answer.status, 200, "metrics status");
    expect(
      counter(answer.text, "remo_gw_requests_total", { provider: "fake", status: "200" }) >= 2,
      "remo_gw_requests_total for the fake provider did not reach 2",
    );
  });

  await step("killing the provider makes the next task say AI is unavailable, not offline", async () => {
    docker(["exec", "-T", "ai-gateway", "node", "apps/ai-gateway/bin/remo-gw.mjs",
      "kill", "provider", PROVIDER, "--reason", "инцидент у провайдера"]);
    const before = metrics.unavailable();

    // The client keeps the gateway's 423 and its scope; the agent boundary keeps the code,
    // which `apps/web/src/agentError.ts` renders as `agents.aiKilled` («ИИ временно
    // недоступен.»), not as the gateway-outage message.
    const client = new AiClient({ model: "fake-model", gateway: GATEWAY, gatewayCa: CA_PEM, log: { error() {} } });
    const aiError = await failureOf(() =>
      client.chatJson({ user: "killed", maxTokens: 64, gateway: { upstream: "fake", orgId: ORG_ID } }),
    );
    equal(aiError.code, "KILLED", "gateway error code");
    equal(aiError.status, 423, "gateway error status");
    equal(aiError.scope, "provider", "gateway error scope");

    const error = await failureOf(() => agentCall(store));
    equal(error.code, "KILLED", "agent error code");
    // The operator's reason travels to the task, as the spec requires (§3.2).
    equal(error.message, "инцидент у провайдера", "agent error message");
    equal(metrics.unavailable(), before, "unavailable counter grew on KILLED");
    equal(runs.at(-1).status, "failed", "journal status for a killed task");
    equal(runs.at(-1).errorCode, "KILLED", "journal error code for a killed task");

    const answer = await httpsJson(`${gatewayUrl}/metrics`, { token: TOKENS.metrics });
    expect(
      counter(answer.text, "remo_gw_killed_total", { scope: "provider" }) >= 1,
      "remo_gw_killed_total{scope=\"provider\"} did not move",
    );
  });

  await step("unkilling the provider returns the work", async () => {
    docker(["exec", "-T", "ai-gateway", "node", "apps/ai-gateway/bin/remo-gw.mjs",
      "unkill", "provider", PROVIDER]);
    const result = await agentCall(store);
    equal(result.completion.gatewayProvider, "fake", "provider after unkill");
    equal(runs.at(-1).status, "ok", "journal status after unkill");
  });

  await step("a provider 500 is UPSTREAM_ERROR, with the provider status", async () => {
    const client = new AiClient({ model: "fake-model", gateway: GATEWAY, gatewayCa: CA_PEM, log: { error() {} } });
    const error = await failureOf(() =>
      client.chatJson({ user: "fail", maxTokens: 64, gateway: { upstream: "fake-down", orgId: ORG_ID } }),
    );
    equal(error.code, "UPSTREAM_ERROR", "upstream error code");
    equal(error.status, 502, "upstream error status");
    equal(error.upstreamStatus, 500, "upstreamStatus");
  });

  await step("a provider that outlives its timeout is UPSTREAM_TIMEOUT", async () => {
    const client = new AiClient({ model: "fake-model", gateway: GATEWAY, gatewayCa: CA_PEM, log: { error() {} } });
    const error = await failureOf(() =>
      client.chatJson({ user: "slow", maxTokens: 64, gateway: { upstream: "fake-slow", orgId: ORG_ID } }),
    );
    equal(error.code, "UPSTREAM_TIMEOUT", "timeout error code");
    equal(error.status, 504, "timeout error status");
  });

  await step("the gateway journal holds metadata only", async () => {
    const result = docker(["exec", "-T", "ai-gateway", "cat", "/var/lib/remo-ai-gateway/requests.log"], {
      capture: true,
    });
    const log = String(result.stdout);
    for (const code of ["KILLED", "UPSTREAM_ERROR", "UPSTREAM_TIMEOUT"]) {
      expect(log.includes(`"code":"${code}"`), `the request log has no ${code} line`);
    }
    expect(log.includes('"provider":"fake"'), "the request log has no fake-provider line");
    expect(!log.includes(MARKER), "the request log contains the prompt text");
    expect(!log.includes(TOKENS.provider), "the request log contains the provider key");
    expect(!log.includes(TOKENS.gateway), "the request log contains the sync token");
  });

  await step("a stopped gateway fails closed and is counted", async () => {
    const before = (await providerStats()).requests;
    const unavailableBefore = metrics.unavailable();
    docker(["stop", "ai-gateway"]);
    const error = await failureOf(() => agentCall(store));
    equal(error.code, "AI_GATEWAY_UNAVAILABLE", "agent error for a stopped gateway");
    equal(metrics.unavailable(), unavailableBefore + 1, "remo_ai_gateway_unavailable_total");
    equal((await providerStats()).requests, before, "the provider was called while the gateway was down");
    equal(runs.at(-1).errorCode, "AI_GATEWAY_UNAVAILABLE", "journal error code while the gateway is down");
  });

  await step("starting the gateway returns the work", async () => {
    docker(["start", "ai-gateway"]);
    await waitForHealth(gatewayUrl, "the gateway", 60_000);
    const result = await agentCall(store);
    equal(result.completion.gatewayProvider, "fake", "provider after restart");
  });
}

/* --------------------------------------------------------------------- main --- */

function summary() {
  const failed = steps.filter((entry) => !entry.ok);
  console.log("\nSummary");
  for (const entry of steps) {
    console.log(`  ${entry.ok ? "ok  " : "FAIL"} ${entry.name} (${entry.ms} ms)`);
  }
  if (failed.length) {
    console.log(`\n${failed.length} step(s) failed.`);
    return 1;
  }
  console.log(`\nAll ${steps.length} steps passed: sync → gateway → fake provider.`);
  return 0;
}

function cleanup() {
  if (KEEP) {
    console.log(`\nStack left up. Certificates: ${CERT_DIR}`);
    console.log(`  docker compose -p ${PROJECT} -f ${FILE} --profile ai logs -f ai-gateway fake-provider`);
    console.log(`  docker compose -p ${PROJECT} -f ${FILE} --profile ai rm -sf ai-gateway fake-provider`);
    console.log("  docker network rm remo-test-ai");
    return;
  }
  docker(["rm", "-sf", "ai-gateway", "fake-provider"], { allowFailure: true });
  // `down` with the `ai` profile would stop the test database too, so the network that
  // only this pair uses is removed on its own, and a failure is not an error.
  spawnSync("docker", ["network", "rm", "remo-test-ai"], { encoding: "utf8", stdio: "pipe" });
  rmSync(CERT_DIR, { recursive: true, force: true });
}

async function main() {
  await step("the gateway and the fake provider start", async () => {
    // `up --wait` has a race with a freshly built dependency (compose asks for a
    // container it has just replaced), so the script waits on /healthz itself.
    docker(["up", "-d", "--build", "fake-provider", "ai-gateway"]);
    await waitForHealth(providerUrl, "the fake provider", 90_000);
    await waitForHealth(gatewayUrl, "the gateway", 90_000);
  });
  await scenario();
  return summary();
}

main()
  .then((code) => {
    cleanup();
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(`\n✗ ${error?.message ?? error}`);
    if (process.env.REMO_E2E_GATEWAY_DEBUG) console.error(error?.stack ?? "");
    const logs = docker(["logs", "--no-log-prefix", "--tail", "120", "ai-gateway", "fake-provider"], {
      capture: true,
      allowFailure: true,
    });
    if (logs.stdout) console.error(`\n--- container logs ---\n${String(logs.stdout).trim()}\n`);
    cleanup();
    process.exitCode = steps.length ? summary() || 1 : 1;
  })
  .finally(() => {
    bindAiMetrics(null);
  });
