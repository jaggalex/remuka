/**
 * The export is bytes, not an object (`spec/pulse.md` §5.1, §5.2).
 *
 * These cases pin the parts a receiver depends on: the signature over the exact body, a
 * stable row order, the suppression of a small cell and the refusal of a future or too long
 * window. The HTTP handler is exercised with a fake metrics pool, so no database is needed.
 */
import { describe, expect, it, vi } from "vitest";
import {
  PULSE_EXPORT_PATH,
  exportPayload,
  handlePulseExport,
  parseExportWindow,
  prepareExportRows,
  pulseSignatureMatches,
  pulseTokenMatches,
  signPulseBody,
} from "./pulse-export.mjs";

const NOW = new Date("2026-11-23T12:00:00.000Z");

function fakeResponse() {
  const out = { status: 0, body: "", headers: {} };
  return {
    out,
    writeHead(status, headers = {}) {
      out.status = status;
      Object.assign(out.headers, headers);
    },
    setHeader(name, value) {
      out.headers[name.toLowerCase()] = value;
    },
    end(text = "") {
      out.body = text;
    },
  };
}

function fakePool(rows) {
  return {
    async query() {
      return { rows };
    },
  };
}

const ROWS = [
  { day: "2026-11-22", metric: "orgs.created", dims: { source: "t.me" }, value: 3, status: "ok", basis: "derived" },
  { day: "2026-11-22", metric: "orgs.created", dims: { source: "habr" }, value: 12, status: "ok", basis: "derived" },
  { day: "2026-11-21", metric: "collab.teams", dims: { period: "week" }, value: 7, status: "ok", basis: "derived" },
  // An operator metric is not an aggregate of §1.2–1.3 and never leaves the installation.
  { day: "2026-11-22", metric: "pulse.viewed", dims: {}, value: 9, status: "ok", basis: "derived" },
];

describe("export rows", () => {
  it("suppresses a small source cell and keeps the real number on this installation", () => {
    const prepared = prepareExportRows(ROWS);
    const small = prepared.find((row) => row.dims.source === "t.me");
    const open = prepared.find((row) => row.dims.source === "habr");
    expect(small).toMatchObject({ status: "suppressed", value: null });
    expect(open).toMatchObject({ status: "ok", value: 12 });
    expect(ROWS[0].value).toBe(3);
  });

  it("orders rows by day, metric and dimensions", () => {
    const prepared = prepareExportRows(ROWS);
    expect(prepared.some((row) => row.metric === "pulse.viewed")).toBe(false);
    expect(prepared.map((row) => `${row.day}/${row.metric}/${row.dims.source ?? row.dims.period}`)).toEqual([
      "2026-11-21/collab.teams/week",
      "2026-11-22/orgs.created/habr",
      "2026-11-22/orgs.created/t.me",
    ]);
  });

  it("omits a value it does not have", () => {
    const payload = exportPayload({
      zone: "ru",
      from: "2026-11-21",
      to: "2026-11-22",
      generatedAt: NOW.toISOString(),
      rows: prepareExportRows(ROWS),
    });
    expect(payload.version).toBe(1);
    const suppressed = payload.rows.find((row) => row.status === "suppressed");
    expect(suppressed).not.toHaveProperty("value");
  });
});

describe("signature and token", () => {
  it("signs the exact bytes and accepts only those bytes", () => {
    const body = "{\"version\":1}";
    const signature = signPulseBody("secret", body);
    expect(signature).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(pulseSignatureMatches("secret", body, signature)).toBe(true);
    expect(pulseSignatureMatches("secret", `${body} `, signature)).toBe(false);
    expect(pulseSignatureMatches("other", body, signature)).toBe(false);
  });

  it("compares tokens through their digests", () => {
    expect(pulseTokenMatches("same", "same")).toBe(true);
    expect(pulseTokenMatches("same", "other")).toBe(false);
    expect(pulseTokenMatches("", "other")).toBe(false);
    expect(pulseTokenMatches("anything", "")).toBe(false);
  });
});

describe("window", () => {
  it("accepts a closed window ending yesterday", () => {
    expect(parseExportWindow({ from: "2026-11-01", to: "2026-11-22", now: NOW })).toMatchObject({
      from: "2026-11-01",
      to: "2026-11-22",
    });
  });

  it.each([
    [{ from: "2026-11-02", to: "2026-11-01" }, "after"],
    [{ from: "2026-11-01", to: "2026-11-23" }, "future"],
    [{ from: "2025-01-01", to: "2026-11-22" }, "longer"],
    [{ from: "2026-13-01", to: "2026-11-22" }, "UTC day"],
    [{ from: "2026-11-01" }, "required"],
  ])("refuses %o", (window, message) => {
    expect(() => parseExportWindow({ ...window, now: NOW })).toThrow(message);
  });
});

describe("the HTTP route", () => {
  const env = { REMO_PULSE_TOKEN: "secret", REMO_COMPLIANCE_ZONE: "eu" };

  it("answers with a signed, uncompressed body and no storage headers", async () => {
    const response = fakeResponse();
    const log = { log: vi.fn(), error: vi.fn() };
    const metrics = { inc: vi.fn() };
    const handled = await handlePulseExport({
      request: { method: "GET", headers: { authorization: "Bearer secret", origin: "https://app.remuka.ru" } },
      response,
      url: new URL(`http://localhost${PULSE_EXPORT_PATH}?from=2026-11-21&to=2026-11-22`),
      env,
      metricsPool: fakePool(ROWS),
      metrics,
      log,
      now: () => NOW,
    });
    expect(handled).toBe(true);
    expect(response.out.status).toBe(200);
    expect(response.out.headers["Cache-Control"]).toBe("no-store");
    expect(response.out.headers["Content-Encoding"]).toBeUndefined();
    expect(pulseSignatureMatches("secret", response.out.body, response.out.headers["X-Pulse-Signature"])).toBe(true);
    // Not a single address or id may leave the installation (§5.5).
    expect(response.out.body).not.toContain("@");
    expect(response.out.body).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i);
    const payload = JSON.parse(response.out.body);
    expect(payload.zone).toBe("eu");
    expect(payload.rows).toHaveLength(3);
    expect(payload.rows[2].status).toBe("suppressed");
    expect(metrics.inc).toHaveBeenCalledWith("remo_pulse_export_rows_total", {}, 3);
  });

  it("answers 404 without a valid token", async () => {
    const response = fakeResponse();
    const handled = await handlePulseExport({
      request: { method: "GET", headers: { authorization: "Bearer wrong" } },
      response,
      url: new URL(`http://localhost${PULSE_EXPORT_PATH}?from=2026-11-21&to=2026-11-22`),
      env,
      metricsPool: fakePool(ROWS),
      now: () => NOW,
    });
    expect(handled).toBe(true);
    expect(response.out.status).toBe(404);
  });

  it("does not exist without a token or outside a known zone", async () => {
    for (const configuration of [
      { REMO_COMPLIANCE_ZONE: "eu" },
      { REMO_PULSE_TOKEN: "secret", REMO_COMPLIANCE_ZONE: "none" },
    ]) {
      const handled = await handlePulseExport({
        request: { method: "GET", headers: {} },
        response: fakeResponse(),
        url: new URL(`http://localhost${PULSE_EXPORT_PATH}`),
        env: configuration,
        metricsPool: fakePool(ROWS),
        now: () => NOW,
      });
      expect(handled).toBe(false);
    }
  });

  it("answers 400 for a future day instead of trimming it", async () => {
    const response = fakeResponse();
    await handlePulseExport({
      request: { method: "GET", headers: { authorization: "Bearer secret" } },
      response,
      url: new URL(`http://localhost${PULSE_EXPORT_PATH}?from=2026-11-22&to=2026-11-23`),
      env,
      metricsPool: fakePool(ROWS),
      now: () => NOW,
    });
    expect(response.out.status).toBe(400);
  });
});
