import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appOriginAliases,
  corsHeadersFor,
  deprecationHeaders,
  isAliasHost,
  isAliasOrigin,
  movedOrigin,
  normalizeOrigin,
  originList,
  requestHost,
  successorOrigin,
} from "./origins.mjs";

/** Only the headers these decisions read; no server is started. */
function request(headers = {}) {
  return { method: "POST", headers: { host: "app.remuka.com", ...headers } };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("allowed origins during the move (ADR-254 §6)", () => {
  it("parses a comma-separated list and drops what is not an origin", () => {
    expect(
      originList("https://remo.letii.ru, https://old.example.com/ , nonsense, https://remo.letii.ru"),
    ).toEqual(["https://remo.letii.ru", "https://old.example.com"]);
    expect(normalizeOrigin("https://app.remuka.com/some/path")).toBe("https://app.remuka.com");
    expect(normalizeOrigin("javascript:alert(1)")).toBeNull();
    expect(normalizeOrigin("")).toBeNull();
  });

  it("recognises an alias origin and refuses everything else", () => {
    vi.stubEnv("REMO_APP_ORIGIN_ALIASES", "https://remo.letii.ru,https://old.example.com");
    expect(isAliasOrigin("https://remo.letii.ru")).toBe(true);
    expect(isAliasOrigin("https://old.example.com")).toBe(true);
    expect(isAliasOrigin("https://evil.example")).toBe(false);
    expect(isAliasOrigin("not a url")).toBe(false);
    expect(appOriginAliases()).toEqual(["https://remo.letii.ru", "https://old.example.com"]);
  });

  it("reads the move target, and keeps the canonical origin when there is none", () => {
    vi.stubEnv("REMO_APP_ORIGIN", "https://remo.letii.ru");
    expect(movedOrigin()).toBeNull();
    expect(successorOrigin()).toBe("https://remo.letii.ru");
    vi.stubEnv("REMO_APP_ORIGIN_MOVED", "https://app.remuka.com");
    expect(movedOrigin()).toBe("https://app.remuka.com");
    expect(successorOrigin()).toBe("https://app.remuka.com");
  });
});

describe("CORS during the move", () => {
  it("echoes the alias that actually called, so a browser accepts it", () => {
    vi.stubEnv("REMO_CORS_ORIGIN", "https://app.remuka.com");
    vi.stubEnv("REMO_APP_ORIGIN_ALIASES", "https://remo.letii.ru");
    const headers = corsHeadersFor(request({ origin: "https://remo.letii.ru" }));
    expect(headers["Access-Control-Allow-Origin"]).toBe("https://remo.letii.ru");
    expect(headers["Access-Control-Allow-Credentials"]).toBe("true");
    expect(headers.Vary).toBe("Origin");
  });

  it("does not echo a foreign origin: the configured value stays, and the browser refuses", () => {
    vi.stubEnv("REMO_CORS_ORIGIN", "https://app.remuka.com");
    vi.stubEnv("REMO_APP_ORIGIN_ALIASES", "https://remo.letii.ru");
    const headers = corsHeadersFor(request({ origin: "https://evil.example" }));
    expect(headers["Access-Control-Allow-Origin"]).toBe("https://app.remuka.com");
  });

  it("keeps the wildcard behaviour of the default installation", () => {
    vi.stubEnv("REMO_CORS_ORIGIN", "*");
    expect(corsHeadersFor(request({ origin: "https://anything.example" }))).toEqual({
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, If-Match, Idempotency-Key, Authorization, X-CSRF-Token",
    });
  });
});

describe("Deprecation headers on an old address", () => {
  it("marks a request whose Origin is an alias, and points at the move target", () => {
    vi.stubEnv("REMO_APP_ORIGIN", "https://remo.letii.ru");
    vi.stubEnv("REMO_APP_ORIGIN_ALIASES", "https://remo.letii.ru");
    vi.stubEnv("REMO_APP_ORIGIN_MOVED", "https://app.remuka.com");
    expect(
      deprecationHeaders(request({ host: "app.remuka.com", origin: "https://remo.letii.ru" })),
    ).toEqual({
      Deprecation: "true",
      Link: '<https://app.remuka.com>; rel="successor-version"',
    });
  });

  it("marks an integration call with no Origin by the old Host", () => {
    vi.stubEnv("REMO_APP_ORIGIN_ALIASES", "https://remo.letii.ru");
    vi.stubEnv("REMO_APP_ORIGIN_MOVED", "https://app.remuka.com");
    expect(deprecationHeaders(request({ host: "remo.letii.ru" }))).toEqual({
      Deprecation: "true",
      Link: '<https://app.remuka.com>; rel="successor-version"',
    });
  });

  it("says nothing on the canonical host or for a foreign caller", () => {
    vi.stubEnv("REMO_APP_ORIGIN_ALIASES", "https://remo.letii.ru");
    vi.stubEnv("REMO_APP_ORIGIN_MOVED", "https://app.remuka.com");
    expect(deprecationHeaders(request({ host: "app.remuka.com" }))).toEqual({});
    expect(
      deprecationHeaders(request({ host: "app.remuka.com", origin: "https://evil.example" })),
    ).toEqual({});
  });

  it("reads X-Forwarded-Host only when the operator trusts the proxy", () => {
    vi.stubEnv("REMO_APP_ORIGIN_ALIASES", "https://remo.letii.ru");
    vi.stubEnv("REMO_APP_ORIGIN_MOVED", "https://app.remuka.com");
    const proxied = request({ host: "app.remuka.com", "x-forwarded-host": "remo.letii.ru" });

    expect(requestHost(proxied)).toBe("app.remuka.com");
    expect(isAliasHost(requestHost(proxied))).toBe(false);

    vi.stubEnv("REMO_TRUST_PROXY", "1");
    expect(requestHost(proxied)).toBe("remo.letii.ru");
    expect(isAliasHost(requestHost(proxied))).toBe(true);
    expect(deprecationHeaders(proxied).Deprecation).toBe("true");
  });
});
