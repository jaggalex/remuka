#!/usr/bin/env node
/**
 * The fake model provider for the gateway acceptance run (`spec/ai-gateway.md` §10).
 *
 * It is an HTTPS OpenAI-compatible endpoint because the gateway's outbound client speaks
 * HTTPS only and refuses private addresses (ADR-109). The compose network gives this
 * container a public-looking address, so the scenario exercises the production path with
 * no escape hatch in the gateway.
 *
 * Control sits in the path rather than in a side channel, so the gateway itself can be
 * pointed at a failing or a slow provider:
 *
 *   POST /chat/completions        200 with a JSON answer
 *   POST /fail/chat/completions   500, which the gateway turns into UPSTREAM_ERROR
 *   POST /slow/chat/completions   the answer after FAKE_PROVIDER_SLOW_MS
 *
 * `?fail=1` and `?slow=1` do the same on the ordinary path. `/__stats` exists for the
 * scenario only: counters plus the header names of the last request, so the run can prove
 * that no `X-Remo-*` header left the gateway.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:https";

const PORT = Number(process.env.FAKE_PROVIDER_PORT ?? 8443);
const CERT_FILE = process.env.FAKE_PROVIDER_TLS_CERT ?? "/certs/provider.pem";
const KEY_FILE = process.env.FAKE_PROVIDER_TLS_KEY ?? "/certs/provider-key.pem";
/** The installation key the gateway is expected to send; empty disables the check. */
const PROVIDER_KEY = String(process.env.FAKE_PROVIDER_KEY ?? "");
const SLOW_MS = Number(process.env.FAKE_PROVIDER_SLOW_MS ?? 2500);
const BODY_LIMIT = 2 * 1024 * 1024;

const stats = { requests: 0, failed: 0, slow: 0, last: null };

function send(res, status, payload) {
  if (res.destroyed || res.headersSent) return;
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function sendText(res, status, text) {
  if (res.destroyed || res.headersSent) return;
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(text);
}

function bearerOf(req) {
  const match = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization ?? "").trim());
  return match ? match[1].trim() : "";
}

function fingerprint(secret) {
  return createHash("sha256").update(String(secret)).digest("hex").slice(0, 12);
}

/** Constant-time bearer check, mirroring what a real provider does with its key. */
function authorized(req) {
  if (!PROVIDER_KEY) return true;
  const expected = fingerprint(PROVIDER_KEY);
  const provided = fingerprint(bearerOf(req));
  return timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        reject(new Error("request body is too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function completion(model, marker) {
  return {
    id: marker,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: JSON.stringify({ nodes: [], note: "fake-provider" }) },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
  };
}

const server = createServer(
  { cert: readFileSync(CERT_FILE), key: readFileSync(KEY_FILE) },
  (req, res) => {
    void (async () => {
      const url = new URL(req.url, "https://fake-provider");
      if (req.method === "GET" && url.pathname === "/healthz") {
        return send(res, 200, { status: "ok" });
      }
      if (req.method === "GET" && url.pathname === "/__stats") {
        return send(res, 200, stats);
      }
      if (req.method === "POST" && url.pathname === "/__reset") {
        stats.requests = 0;
        stats.failed = 0;
        stats.slow = 0;
        stats.last = null;
        return send(res, 200, stats);
      }
      const chat = /^\/(fail|slow)?\/?chat\/completions$/.exec(url.pathname);
      if (req.method !== "POST" || !chat) return sendText(res, 404, "not found");
      if (!authorized(req)) {
        return send(res, 401, { error: { message: "the provider key is not valid", type: "auth" } });
      }

      const raw = await readBody(req);
      let body = null;
      try {
        body = JSON.parse(raw);
      } catch {
        return send(res, 400, { error: { message: "the body is not JSON", type: "invalid_request" } });
      }
      const mode = chat[1] ?? (url.searchParams.get("fail") === "1"
        ? "fail"
        : url.searchParams.get("slow") === "1"
          ? "slow"
          : "");
      stats.requests += 1;
      stats.last = {
        path: url.pathname,
        model: body?.model ?? null,
        // Names only: the scenario needs to know which headers arrived, not their values.
        headers: Object.keys(req.headers).sort(),
        // A fingerprint, not the key: enough to prove which key arrived.
        keyFingerprint: bearerOf(req) ? fingerprint(bearerOf(req)) : null,
        remoHeaders: Object.keys(req.headers).filter((name) => name.startsWith("x-remo-")),
      };

      if (mode === "fail") {
        stats.failed += 1;
        return send(res, 500, { error: { message: "the fake provider failed on purpose", type: "server" } });
      }
      if (mode === "slow") {
        stats.slow += 1;
        await new Promise((resolve) => setTimeout(resolve, SLOW_MS));
      }
      return send(res, 200, completion(body?.model ?? "fake-model", `fake-${stats.requests}`));
    })().catch((error) => send(res, 500, { error: { message: String(error?.message ?? error) } }));
  },
);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`fake provider listening on https://0.0.0.0:${PORT}`);
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
