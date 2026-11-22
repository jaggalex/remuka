/**
 * Registration enforces legal acceptance before it costs anything (ADR-256 §4).
 *
 * The unit test of the registry lives in `legal.test.mjs`; this file proves the wiring:
 * `POST /auth/register` refuses an incomplete or stale acceptance with a 400 before the
 * rate limiter spends an attempt and before scrypt runs, writes the journal rows in the
 * same call as the account, and honours the address setting.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { legalTextSha256 } from "@remo/legal";
import { handleIam } from "./iam-api.mjs";
import { resolveLegal } from "./legal.mjs";

const OFFER = "# Оферта\n\nТекст оферты.\n";
const CONSENT = "# Согласие\n\nТекст согласия.\n";
const TERMS = "# Terms\n\nTerms text.\n";
const OFFER_HASH = legalTextSha256(OFFER);
const CONSENT_HASH = legalTextSha256(CONSENT);
const TERMS_HASH = legalTextSha256(TERMS);

function fixture(zone = "ru") {
  const root = mkdtempSync(join(tmpdir(), "legal-register-"));
  const documents =
    zone === "ru"
      ? [
          {
            zone: "ru",
            doc: "offer",
            title: { ru: "Оферта" },
            current: 1,
            status: "published",
            effective: "2026-12-01",
            required: "signup",
            reaccept: true,
            lang: ["ru"],
            sha256: { 1: OFFER_HASH },
          },
          {
            zone: "ru",
            doc: "consent",
            title: { ru: "Согласие" },
            current: 1,
            status: "published",
            effective: "2026-12-01",
            required: "signup",
            reaccept: true,
            lang: ["ru"],
            sha256: { 1: CONSENT_HASH },
          },
        ]
      : [
          {
            zone: "eu",
            doc: "terms",
            title: { en: "Terms" },
            current: 1,
            status: "published",
            effective: "2026-12-01",
            required: "signup",
            reaccept: true,
            lang: ["en"],
            sha256: { 1: TERMS_HASH },
          },
        ];
  const files =
    zone === "ru"
      ? { "ru/offer/1.ru.md": OFFER, "ru/consent/1.ru.md": CONSENT }
      : { "eu/terms/1.en.md": TERMS };
  mkdirSync(join(root, "content", "legal"), { recursive: true });
  writeFileSync(
    join(root, "content", "legal", "index.json"),
    `${JSON.stringify({ documents }, null, 2)}\n`,
  );
  for (const [path, text] of Object.entries(files)) {
    const full = join(root, "content", "legal", path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
  }
  return root;
}

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
    json() {
      return this.body ? JSON.parse(this.body) : null;
    },
  };
}

function request(body, ip = "203.0.113.10") {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  return {
    method: "POST",
    headers: { "user-agent": "legal-register-test" },
    socket: { remoteAddress: ip },
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk;
    },
  };
}

const USER = { id: "u-1", email: "a@example.test", name: "A", handle: "a" };

function fakeStore() {
  const calls = { createUser: [], createUserWithAcceptances: [], audits: [] };
  const store = {
    createUser: vi.fn(async (args) => {
      calls.createUser.push(args);
      return { ...USER, state: "active", theme: null, lang: null, created_at: new Date() };
    }),
    createUserWithAcceptances: vi.fn(async (args) => {
      calls.createUserWithAcceptances.push(args);
      return { ...USER, state: "active", theme: null, lang: null, created_at: new Date() };
    }),
    findUserByEmail: vi.fn(async () => null),
    findUserByHandle: vi.fn(async () => null),
    createOrgWithOwner: vi.fn(async () => ({
      org: { id: "o-1", name: "A", slug: "a" },
      team: { id: "t-1", name: "General" },
    })),
    createSession: vi.fn(async () => ({})),
    recordAudit: vi.fn(async (event) => {
      calls.audits.push(event);
    }),
  };
  return { store, calls };
}

async function register({ legal, body, store, ip }) {
  const out = response();
  const handled = await handleIam({
    request: request(body, ip),
    response: out,
    url: new URL("http://sync.test/auth/register"),
    store,
    legal,
    log: { error() {} },
  });
  return { handled, out, body: out.json() };
}

const currentAcceptances = () => [
  { doc: "offer", version: 1, sha256: OFFER_HASH },
  { doc: "consent", version: 1, sha256: CONSENT_HASH },
];

const signup = (extra = {}) => ({
  email: `legal-${Math.random().toString(16).slice(2)}@example.test`,
  password: "correct horse battery",
  name: "Legal",
  ...extra,
});

beforeEach(() => {
  process.env.REMO_KEK = Buffer.alloc(32, 7).toString("base64");
  delete process.env.REMO_LEGAL_STORE_IP;
  delete process.env.REMO_LEGAL_IP_RETENTION_DAYS;
  delete process.env.REMO_REGISTER_LIMIT;
});

afterEach(() => {
  delete process.env.REMO_KEK;
  delete process.env.REMO_LEGAL_STORE_IP;
  delete process.env.REMO_LEGAL_IP_RETENTION_DAYS;
  delete process.env.REMO_REGISTER_LIMIT;
});

describe("POST /auth/register and legal acceptances (ADR-256 §4)", () => {
  it("refuses a sign-up without the required documents, before the rate limit", async () => {
    process.env.REMO_REGISTER_LIMIT = "1";
    const legal = resolveLegal(
      { REMO_COMPLIANCE_ZONE: "ru" },
      { zone: "ru", origin: "https://app.remuka.ru", cwd: fixture("ru") },
    );
    const { store, calls } = fakeStore();

    const refused = await register({ legal, body: signup(), store, ip: "198.51.100.20" });
    expect(refused.handled).toBe(true);
    expect(refused.out.status).toBe(400);
    expect(refused.body).toMatchObject({
      error: "LEGAL_ACCEPTANCE_REQUIRED",
      missing: ["offer", "consent"],
    });
    expect(calls.createUser).toEqual([]);
    expect(calls.createUserWithAcceptances).toEqual([]);

    // The same address may still register: the refused request did not spend its one
    // allowed attempt.
    const ok = await register({
      legal,
      body: signup({ acceptances: currentAcceptances() }),
      store,
      ip: "198.51.100.20",
    });
    expect(ok.out.status).toBe(201);
    expect(calls.createUserWithAcceptances).toHaveLength(1);
  });

  it("refuses an old hash or revision as a changed document", async () => {
    const legal = resolveLegal(
      { REMO_COMPLIANCE_ZONE: "ru" },
      { zone: "ru", origin: "https://app.remuka.ru", cwd: fixture("ru") },
    );
    const { store, calls } = fakeStore();
    const stale = await register({
      legal,
      body: signup({
        acceptances: [
          { doc: "offer", version: 1, sha256: "0".repeat(64) },
          { doc: "consent", version: 1, sha256: CONSENT_HASH },
        ],
      }),
      store,
      ip: "198.51.100.21",
    });
    expect(stale.out.status).toBe(400);
    expect(stale.body.error).toBe("LEGAL_VERSION_CHANGED");
    expect(stale.body.documents).toEqual([
      { doc: "offer", version: 1, sha256: OFFER_HASH },
      { doc: "consent", version: 1, sha256: CONSENT_HASH },
    ]);
    expect(calls.createUserWithAcceptances).toEqual([]);
  });

  it("refuses documents of another zone", async () => {
    const legal = resolveLegal(
      { REMO_COMPLIANCE_ZONE: "ru" },
      { zone: "ru", origin: "https://app.remuka.ru", cwd: fixture("ru") },
    );
    const { store } = fakeStore();
    const mixed = await register({
      legal,
      body: signup({
        acceptances: [{ doc: "terms", version: 1, sha256: TERMS_HASH }],
      }),
      store,
      ip: "198.51.100.22",
    });
    expect(mixed.out.status).toBe(400);
    expect(mixed.body).toMatchObject({
      error: "LEGAL_ACCEPTANCE_REQUIRED",
      missing: ["offer", "consent"],
    });
  });

  it("writes one row per required document with the registry's values", async () => {
    const legal = resolveLegal(
      { REMO_COMPLIANCE_ZONE: "ru" },
      { zone: "ru", origin: "https://app.remuka.ru", cwd: fixture("ru") },
    );
    const { store, calls } = fakeStore();
    const ok = await register({
      legal,
      body: signup({
        acceptances: [
          ...currentAcceptances(),
          // The request cannot add a document the server did not ask for.
          { doc: "privacy", version: 99, sha256: "f".repeat(64) },
        ],
      }),
      store,
      ip: "198.51.100.23",
    });
    expect(ok.out.status).toBe(201);
    const [call] = calls.createUserWithAcceptances;
    expect(call.acceptances).toHaveLength(2);
    expect(call.acceptances.map((row) => `${row.zone}/${row.doc} v${row.version}`)).toEqual([
      "ru/offer v1",
      "ru/consent v1",
    ]);
    for (const row of call.acceptances) {
      expect(row.sha256).toMatch(/^[a-f0-9]{64}$/);
      // The Russian default keeps the address as a keyed digest, never as an address.
      expect(row.ipHash).toMatch(/^[a-f0-9]{64}$/);
      expect(row.userAgent).toBe("legal-register-test");
    }
    expect(calls.createUser).toEqual([]);
  });

  it("keeps no address digest when REMO_LEGAL_STORE_IP=0", async () => {
    process.env.REMO_LEGAL_STORE_IP = "0";
    const legal = resolveLegal(
      { REMO_COMPLIANCE_ZONE: "ru", REMO_LEGAL_STORE_IP: "0" },
      { zone: "ru", origin: "https://app.remuka.ru", cwd: fixture("ru") },
    );
    const { store, calls } = fakeStore();
    await register({
      legal,
      body: signup({ acceptances: currentAcceptances() }),
      store,
      ip: "198.51.100.24",
    });
    expect(calls.createUserWithAcceptances[0].acceptances.every((row) => row.ipHash === null)).toBe(
      true,
    );
  });

  it("asks nothing and writes no acceptance row in the none zone", async () => {
    const legal = resolveLegal({ REMO_COMPLIANCE_ZONE: "none" }, { zone: "none" });
    const { store, calls } = fakeStore();
    const ok = await register({ legal, body: signup(), store, ip: "198.51.100.25" });
    expect(ok.out.status).toBe(201);
    expect(calls.createUser).toHaveLength(1);
    expect(calls.createUserWithAcceptances).toEqual([]);
  });
});
