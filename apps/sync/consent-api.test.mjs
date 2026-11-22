import { describe, expect, it, vi } from "vitest";
import { POLICY_VERSION } from "@remo/consent";
import { hashToken } from "./iam.mjs";
import { handleConsentRoutes } from "./consent-api.mjs";

const ZONE_EU = "eu";
const ZONE_RU = "ru";

function response() {
  const headers = new Map();
  return {
    status: 0,
    body: "",
    headers,
    setHeader(name, value) {
      headers.set(name.toLowerCase(), value);
    },
    getHeader(name) {
      return headers.get(name.toLowerCase());
    },
    writeHead(status, values = {}) {
      this.status = status;
      for (const [name, value] of Object.entries(values)) {
        headers.set(name.toLowerCase(), value);
      }
    },
    end(body) {
      this.body = body;
    },
    setCookies() {
      const value = headers.get("set-cookie");
      if (value === undefined) return [];
      return Array.isArray(value) ? value : [value];
    },
    json() {
      return this.body ? JSON.parse(this.body) : null;
    },
  };
}

function request({ method = "POST", headers = {}, body, ip = "203.0.113.7" } = {}) {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  return {
    method,
    headers,
    socket: { remoteAddress: ip },
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk;
    },
  };
}

/** A Postgres-row-shaped event, so the change detector sees what the database returns. */
function row({ userId, zone, choices, policyVersion, index = 0 }) {
  return {
    id: `event-${index}`,
    user_id: userId,
    zone,
    choices,
    policy_version: policyVersion,
    user_agent: null,
    ip_hash: null,
    created_at: new Date(Date.UTC(2026, 10, 22, 12, 0, index)),
  };
}

function fakeStore({ sessions = {}, initial = [] } = {}) {
  const events = [...initial];
  const api = {
    findSession: async (tokenHash) => sessions[tokenHash] ?? null,
    touchSession: async () => {},
    recordConsentEvent: vi.fn(async (event) => {
      const created = row({
        userId: event.userId,
        zone: event.zone,
        choices: event.choices,
        policyVersion: event.policyVersion,
        index: events.length,
      });
      created.user_agent = event.userAgent;
      created.ip_hash = event.ipHash;
      events.push(created);
      return created;
    }),
    latestConsentEvent: async (userId) =>
      [...events].reverse().find((event) => event.user_id === userId) ?? null,
  };
  return { store: api, events };
}

function sessionFor(userId, tag) {
  return {
    id: `session-${tag}`,
    user_id: userId,
    email: `${tag}@example.test`,
    name: tag,
    handle: tag,
    theme: null,
    lang: null,
    email_verified_at: null,
  };
}

async function call({
  store = fakeStore().store,
  zone = ZONE_EU,
  secure = false,
  method = "POST",
  body,
  headers = {},
  url = "/consent",
  metrics = null,
} = {}) {
  const out = response();
  const handled = await handleConsentRoutes({
    request: request({ method, body, headers }),
    response: out,
    url: new URL(`http://sync.test${url}`),
    store,
    zone,
    secure,
    metrics,
    log: { error() {} },
  });
  return { handled, out };
}

describe("POST /consent (ADR-255 §4)", () => {
  it("sets one readable, first-party cookie and answers the effective choice", async () => {
    const { handled, out } = await call({
      body: { zone: "eu", choices: { analytics: true }, policyVersion: POLICY_VERSION },
    });

    expect(handled).toBe(true);
    expect(out.status).toBe(200);
    expect(out.json()).toMatchObject({
      zone: "eu",
      policyVersion: POLICY_VERSION,
      choices: { necessary: true, preferences: true, analytics: true, marketing: false },
    });
    expect(typeof out.json().expiresAt).toBe("string");
    expect(Date.parse(out.json().expiresAt)).toBeGreaterThan(Date.now());

    const cookie = out.setCookies()[0];
    expect(cookie).toContain(`remo_consent=v1.eu.${POLICY_VERSION}.a`);
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain(`Max-Age=${180 * 24 * 60 * 60}`);
    expect(cookie).not.toContain("HttpOnly");
    expect(cookie).not.toContain("Secure");
  });

  it("keeps a year in the Russian zone and adds Secure only in production", async () => {
    const ru = await call({
      zone: ZONE_RU,
      body: { zone: "ru", choices: { marketing: true }, policyVersion: POLICY_VERSION },
    });
    expect(ru.out.setCookies()[0]).toContain(`Max-Age=${365 * 24 * 60 * 60}`);
    expect(ru.out.setCookies()[0]).toContain(`remo_consent=v1.ru.${POLICY_VERSION}.m`);

    const production = await call({
      secure: true,
      body: { zone: "eu", policyVersion: POLICY_VERSION },
    });
    expect(production.out.setCookies()[0]).toContain("; Secure");
  });

  it("ignores the categories that are not asked: necessary and preferences", async () => {
    const { out } = await call({
      body: {
        zone: "eu",
        choices: { necessary: false, preferences: false, analytics: true },
        policyVersion: POLICY_VERSION,
      },
    });
    expect(out.status).toBe(200);
    expect(out.json().choices).toMatchObject({
      necessary: true,
      preferences: true,
      analytics: true,
    });
    expect(out.setCookies()[0]).toContain(`v1.eu.${POLICY_VERSION}.a`);
  });

  it("grants only what was asked", async () => {
    const { out } = await call({
      body: {
        zone: "eu",
        choices: { analytics: false, marketing: true },
        policyVersion: POLICY_VERSION,
      },
    });
    expect(out.status).toBe(200);
    expect(out.json().choices).toMatchObject({
      necessary: true,
      analytics: false,
      marketing: true,
    });
    expect(out.setCookies()[0]).toContain(`v1.eu.${POLICY_VERSION}.m`);
  });

  it("refuses a choice from the other zone with 409 ZONE_MISMATCH", async () => {
    const { store, events } = fakeStore();
    const { out } = await call({
      store,
      zone: ZONE_EU,
      body: { zone: "ru", choices: { analytics: true }, policyVersion: POLICY_VERSION },
    });
    expect(out.status).toBe(409);
    expect(out.json()).toMatchObject({ error: "ZONE_MISMATCH", zone: "eu" });
    expect(out.setCookies()).toEqual([]);
    expect(events).toEqual([]);
  });

  it("refuses an unknown category with 422 UNKNOWN_CATEGORY", async () => {
    const { out } = await call({
      body: { zone: "eu", choices: { advertising: true }, policyVersion: POLICY_VERSION },
    });
    expect(out.status).toBe(422);
    expect(out.json().error).toBe("UNKNOWN_CATEGORY");
    expect(out.setCookies()).toEqual([]);
  });

  it("answers the policy edition it stored, so GET and POST carry the same field", async () => {
    const { out } = await call({
      body: { zone: "eu", choices: { analytics: true }, policyVersion: POLICY_VERSION },
    });
    const read = await call({
      method: "GET",
      headers: { cookie: out.setCookies()[0].split(";")[0] },
    });
    expect(out.json().policyVersion).toBe(POLICY_VERSION);
    expect(read.out.json().policyVersion).toBe(out.json().policyVersion);
  });

  it("refuses a stale policy edition with 409 POLICY_OUTDATED and names the current one", async () => {
    const { store, events } = fakeStore();
    const { out } = await call({
      store,
      body: { zone: "eu", choices: { analytics: true }, policyVersion: "2026-01" },
    });
    expect(out.status).toBe(409);
    expect(out.json()).toMatchObject({ error: "POLICY_OUTDATED", current: POLICY_VERSION });
    expect(out.setCookies()).toEqual([]);
    expect(store.recordConsentEvent).not.toHaveBeenCalled();
    expect(events).toEqual([]);
    // The structured field is what a client reads, not the message.
    expect(out.getHeader("cache-control")).toBe("no-store");
  });

  it("refuses a non-boolean value and a missing policy edition", async () => {
    const value = await call({
      body: { zone: "eu", choices: { analytics: "yes" }, policyVersion: POLICY_VERSION },
    });
    expect(value.out.status).toBe(422);
    expect(value.out.json().error).toBe("BAD_CHOICES");

    const edition = await call({
      body: { zone: "eu", choices: { analytics: true } },
    });
    expect(edition.out.status).toBe(422);
    expect(edition.out.json().error).toBe("BAD_POLICY_VERSION");
    expect(edition.out.setCookies()).toEqual([]);
  });

  it("stores nothing for a guest", async () => {
    const { store, events } = fakeStore();
    const { out } = await call({
      store,
      body: { zone: "eu", choices: { analytics: true }, policyVersion: POLICY_VERSION },
    });
    expect(out.status).toBe(200);
    expect(store.recordConsentEvent).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it("writes one journal row per change for a signed-in person", async () => {
    vi.stubEnv("REMO_KEK", Buffer.alloc(32, 7).toString("base64"));
    try {
      const { store, events } = fakeStore({
        sessions: { [hashToken("token-a")]: sessionFor("user-a", "anna") },
      });
      const headers = {
        cookie: "remo_session=token-a",
        "user-agent": `Test browser ${"x".repeat(600)}`,
      };

      const first = await call({
        store,
        headers,
        body: { zone: "eu", choices: { analytics: true }, policyVersion: POLICY_VERSION },
      });
      expect(first.out.status).toBe(200);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        user_id: "user-a",
        zone: "eu",
        choices: { analytics: true, marketing: false },
        policy_version: POLICY_VERSION,
      });
      expect(events[0].user_agent.length).toBe(512);
      expect(events[0].ip_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(events[0].ip_hash).not.toContain("203.0.113.7");

      // The same choice again is not a new decision.
      await call({
        store,
        headers,
        body: { zone: "eu", choices: { analytics: true }, policyVersion: POLICY_VERSION },
      });
      expect(events).toHaveLength(1);

      // A real change is a second row.
      await call({
        store,
        headers,
        body: {
          zone: "eu",
          choices: { analytics: true, marketing: true },
          policyVersion: POLICY_VERSION,
        },
      });
      expect(events).toHaveLength(2);
      expect(events[1].choices).toEqual({ analytics: true, marketing: true });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("keeps two accounts' journals apart", async () => {
    const { store, events } = fakeStore({
      sessions: {
        [hashToken("token-a")]: sessionFor("user-a", "anna"),
        [hashToken("token-b")]: sessionFor("user-b", "boris"),
      },
    });

    await call({
      store,
      headers: { cookie: "remo_session=token-a" },
      body: { zone: "eu", choices: { analytics: true }, policyVersion: POLICY_VERSION },
    });
    await call({
      store,
      headers: { cookie: "remo_session=token-b" },
      body: { zone: "eu", choices: { marketing: true }, policyVersion: POLICY_VERSION },
    });

    expect(events.map((event) => event.user_id)).toEqual(["user-a", "user-b"]);
    expect(await store.latestConsentEvent("user-a")).toMatchObject({
      choices: { analytics: true, marketing: false },
    });
    expect(await store.latestConsentEvent("user-b")).toMatchObject({
      choices: { analytics: false, marketing: true },
    });
  });

  it("sets no cookie and writes nothing in the none zone", async () => {
    const { store, events } = fakeStore();
    const { out } = await call({
      store,
      zone: "none",
      body: { zone: "none", choices: { analytics: true }, policyVersion: POLICY_VERSION },
    });
    expect(out.status).toBe(200);
    expect(out.json()).toEqual({
      zone: "none",
      policyVersion: POLICY_VERSION,
      choices: { necessary: true, preferences: true, analytics: false, marketing: false },
      expiresAt: null,
    });
    expect(out.setCookies()).toEqual([]);
    expect(events).toEqual([]);
  });

  it("counts a failed journal write and still saves the choice", async () => {
    const metrics = { inc: vi.fn() };
    const recordConsentEvent = vi.fn(async () => {
      throw new Error("database is down");
    });
    const store = {
      findSession: async () => sessionFor("user-a", "anna"),
      touchSession: async () => {},
      recordConsentEvent,
    };
    const { out } = await call({
      store,
      metrics,
      headers: { cookie: "remo_session=token-a" },
      body: { zone: "eu", choices: { analytics: true }, policyVersion: POLICY_VERSION },
    });
    // The choice is what matters; the proof is what was lost (question (б) of §11).
    expect(out.status).toBe(200);
    expect(out.json().choices.analytics).toBe(true);
    expect(out.setCookies()[0]).toContain(`v1.eu.${POLICY_VERSION}.a`);
    expect(recordConsentEvent).toHaveBeenCalledTimes(1);
    expect(metrics.inc).toHaveBeenCalledTimes(1);
    expect(metrics.inc).toHaveBeenCalledWith("consent_journal_failed_total");
  });

  it("does not count a journal write that succeeded", async () => {
    const metrics = { inc: vi.fn() };
    const { store } = fakeStore({
      sessions: { [hashToken("token-a")]: sessionFor("user-a", "anna") },
    });
    const { out } = await call({
      store,
      metrics,
      headers: { cookie: "remo_session=token-a" },
      body: { zone: "eu", choices: { analytics: true }, policyVersion: POLICY_VERSION },
    });
    expect(out.status).toBe(200);
    expect(metrics.inc).not.toHaveBeenCalled();
  });

  it("refuses an unknown method", async () => {
    const { out } = await call({ method: "DELETE" });
    expect(out.status).toBe(405);
    expect(out.getHeader("allow")).toBe("GET, POST");
  });
});

describe("GET /consent", () => {
  it("reads the current value without writing", async () => {
    const { store, events } = fakeStore({
      sessions: { [hashToken("token-a")]: sessionFor("user-a", "anna") },
    });
    const { out } = await call({
      store,
      method: "GET",
      headers: { cookie: `remo_consent=v1.eu.${POLICY_VERSION}.am; remo_session=token-a` },
    });
    expect(out.status).toBe(200);
    expect(out.json()).toEqual({
      zone: "eu",
      choices: { necessary: true, preferences: true, analytics: true, marketing: true },
      policyVersion: POLICY_VERSION,
    });
    expect(events).toEqual([]);
  });

  it("answers null for no cookie, a corrupt cookie and another zone", async () => {
    for (const cookie of [
      undefined,
      `remo_consent=v1.eu.${POLICY_VERSION}.x`,
      `remo_consent=v1.ru.${POLICY_VERSION}.a`,
    ]) {
      const { out } = await call({
        method: "GET",
        headers: cookie ? { cookie } : {},
      });
      expect(out.status, String(cookie)).toBe(200);
      expect(out.json(), String(cookie)).toBeNull();
    }
  });
});
