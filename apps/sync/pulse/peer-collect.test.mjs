/**
 * The collector's refusals are the security boundary (`spec/pulse.md` §5.3, §5.5).
 *
 * These cases need no database: they pin origin parsing, thirty-day windows and the
 * validation that keeps identifiers, unknown dimensions and dishonest values out of the
 * receiving installation.
 */
import { describe, expect, it } from "vitest";
import {
  exportWindows,
  parsePeerOrigins,
  validateExportPayload,
} from "./peer-collect.mjs";

const GOOD = {
  version: 1,
  zone: "ru",
  generatedAt: "2026-11-23T03:00:00.000Z",
  from: "2026-11-01",
  to: "2026-11-22",
  rows: [
    { day: "2026-11-22", metric: "orgs.created", dims: { source: "habr" }, value: 12, status: "ok", basis: "derived" },
    { day: "2026-11-22", metric: "orgs.created", dims: { source: "t.me" }, status: "suppressed", basis: "derived" },
    { day: "2026-11-21", metric: "collab.teams", dims: { period: "week" }, value: 7, status: "ok", basis: "derived" },
  ],
};

describe("peer origins", () => {
  it("normalises a list of https origins", () => {
    expect(
      parsePeerOrigins("https://app.remuka.ru, https://app.remuka.ru/"),
    ).toEqual(["https://app.remuka.ru"]);
  });

  it.each([
    "http://app.remuka.ru",
    "https://app.remuka.ru/api",
    "https://user:pass@app.remuka.ru",
    "https://localhost:8443",
    "https://10.0.0.5",
    "not an address",
  ])("refuses %s", (value) => {
    expect(() => parsePeerOrigins(value)).toThrow();
  });
});

describe("windows", () => {
  it("splits a range into thirty-day windows without gaps or overlaps", () => {
    const windows = exportWindows("2026-01-01", "2026-03-05");
    expect(windows[0]).toEqual({ from: "2026-01-01", to: "2026-01-30" });
    expect(windows.at(-1).to).toBe("2026-03-05");
    for (let index = 1; index < windows.length; index += 1) {
      const previous = new Date(`${windows[index - 1].to}T00:00:00.000Z`).getTime();
      const next = new Date(`${windows[index].from}T00:00:00.000Z`).getTime();
      expect(next - previous).toBe(24 * 60 * 60 * 1000);
    }
  });
});

describe("payload", () => {
  it("accepts a body with no identifiers", () => {
    const checked = validateExportPayload(GOOD, { zone: "eu" });
    expect(checked.zone).toBe("ru");
    expect(checked.rows).toHaveLength(3);
    expect(checked.rows[1]).toMatchObject({ status: "suppressed", value: null });
  });

  it("refuses the opening installation's own zone", () => {
    expect(() => validateExportPayload(GOOD, { zone: "ru" })).toThrow("own zone");
  });

  it("refuses a source that changed its zone", () => {
    expect(() => validateExportPayload(GOOD, { zone: "eu", rememberedZone: "eu" })).toThrow(
      "changed its zone",
    );
  });

  it.each([
    ["an unknown dimension", { ...GOOD, rows: [{ ...GOOD.rows[0], dims: { org_id: "x" } }] }],
    ["an address in a dimension", { ...GOOD, rows: [{ ...GOOD.rows[0], dims: { source: "a@b" } }] }],
    ["ok without a value", { ...GOOD, rows: [{ ...GOOD.rows[0], value: null }] }],
    ["a negative value", { ...GOOD, rows: [{ ...GOOD.rows[0], value: -1 }] }],
    ["a value under unavailable", { ...GOOD, rows: [{ ...GOOD.rows[1], value: 3 }] }],
    ["an unknown status", { ...GOOD, rows: [{ ...GOOD.rows[0], status: "secret" }] }],
    ["an unknown basis", { ...GOOD, rows: [{ ...GOOD.rows[0], basis: "guess" }] }],
    ["a reversed window", { ...GOOD, from: "2026-11-22", to: "2026-11-01" }],
    ["a future version", { ...GOOD, version: 2 }],
  ])("refuses %s", (_name, payload) => {
    expect(() => validateExportPayload(payload, { zone: "eu" })).toThrow();
  });
});
