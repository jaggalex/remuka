/**
 * The signed-in legal surface (ADR-256 §4–§6).
 *
 * Proves the three decisions the page and the window depend on: the state comes from the
 * journal and the registry, an acceptance writes registry values in one call, and a
 * withdrawal is allowed only for a document the index marks `withdrawable` and records
 * the revision it withdraws.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { legalTextSha256 } from "@remo/legal";
import { handleIam } from "./iam-api.mjs";
import { resolveLegal } from "./legal.mjs";

const OFFER = "# Оферта\n\nТекст оферты.\n";
const CONSENT = "# Согласие\n\nТекст согласия.\n";
const PRIVACY = "# Политика\n\nТекст политики.\n";
const OFFER_HASH = legalTextSha256(OFFER);
const CONSENT_HASH = legalTextSha256(CONSENT);
const PRIVACY_HASH = legalTextSha256(PRIVACY);

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "legal-account-"));
  const documents = [
    {
      zone: "ru",
      doc: "offer",
      title: { ru: "Оферта" },
      current: 1,
      status: "published",
      effective: "2026-11-01",
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
      effective: "2026-11-01",
      required: "signup",
      reaccept: true,
      withdrawable: true,
      lang: ["ru"],
      sha256: { 1: CONSENT_HASH },
    },
    {
      zone: "ru",
      doc: "privacy",
      title: { ru: "Политика" },
      current: 1,
      status: "published",
      effective: "2026-11-01",
      required: "none",
      reaccept: false,
      lang: ["ru"],
      sha256: { 1: PRIVACY_HASH },
    },
  ];
  mkdirSync(join(root, "content", "legal"), { recursive: true });
  writeFileSync(
    join(root, "content", "legal", "index.json"),
    `${JSON.stringify({ documents }, null, 2)}\n`,
  );
  for (const [path, text] of Object.entries({
    "ru/offer/1.ru.md": OFFER,
    "ru/consent/1.ru.md": CONSENT,
    "ru/privacy/1.ru.md": PRIVACY,
  })) {
    const full = join(root, "content", "legal", path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
  }
  return resolveLegal({ REMO_COMPLIANCE_ZONE: "ru" }, { zone: "ru", origin: "https://app.remuka.ru", cwd: root });
}

const USER = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "anna@example.test",
  name: "Anna",
  handle: "anna",
};

function response() {
  return {
    status: 0,
    body: "",
    headers: new Map(),
    writeHead(status, values = {}) {
      this.status = status;
      for (const [name, value] of Object.entries(values)) this.headers.set(name.toLowerCase(), value);
    },
    end(body) {
      this.body = body;
    },
    json() {
      return this.body ? JSON.parse(this.body) : null;
    },
  };
}

function request(method, body, { session = true } = {}) {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  return {
    method,
    headers: {
      "user-agent": "legal-account-test",
      ...(session ? { cookie: "remo_session=token" } : {}),
    },
    socket: { remoteAddress: "203.0.113.10" },
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk;
    },
  };
}

function fakeStore(initial = []) {
  const latest = initial.map((row) => ({ ...row }));
  const calls = [];
  return {
    latest,
    calls,
    createUser: vi.fn(),
    touchSession: vi.fn(async () => {}),
    findSession: vi.fn(async () =>
      latest === null
        ? null
        : {
            id: "22222222-2222-4222-8222-222222222222",
            user_id: USER.id,
            email: USER.email,
            name: USER.name,
            handle: USER.handle,
            email_verified_at: new Date(),
            theme: null,
            lang: null,
          },
    ),
    latestLegalAcceptances: vi.fn(async () => latest),
    recordLegalAcceptances: vi.fn(async ({ rows }) => {
      calls.push(rows);
      for (const row of rows) {
        const index = latest.findIndex((entry) => entry.doc === row.doc);
        const stored = {
          doc: row.doc,
          zone: row.zone,
          version: row.version,
          sha256: row.sha256,
          event: row.event,
          accepted_at: new Date().toISOString(),
        };
        if (index === -1) latest.push(stored);
        else latest[index] = stored;
      }
      return rows;
    }),
  };
}

async function call(store, legal, method, path, body, options) {
  const res = response();
  const url = new URL(`http://localhost${path}`);
  const handled = await handleIam({
    request: request(method, body, options),
    response: res,
    url,
    store,
    legal,
  });
  expect(handled).toBe(true);
  return res;
}

const accepted = (doc, hash) => ({
  doc,
  zone: "ru",
  version: 1,
  sha256: hash,
  event: "accept",
  accepted_at: "2026-11-20T10:00:00.000Z",
});

describe("GET /account/legal", () => {
  it("needs a session", async () => {
    const res = await call(fakeStore(), fixture(), "GET", "/account/legal", undefined, {
      session: false,
    });
    expect(res.status).toBe(401);
    expect(res.json().error).toBe("AUTH_REQUIRED");
  });

  it("asks for every reaccept document an account has never accepted", async () => {
    const res = await call(fakeStore(), fixture(), "GET", "/account/legal");
    expect(res.status).toBe(200);
    expect(res.json().pending).toEqual(["offer", "consent"]);
    expect(res.json().documents.map((doc) => `${doc.doc}:${doc.accepted}`)).toEqual([
      "offer:false",
      "consent:false",
      "privacy:false",
    ]);
  });

  it("is quiet once the current revision is accepted", async () => {
    const store = fakeStore([accepted("offer", OFFER_HASH), accepted("consent", CONSENT_HASH)]);
    const res = await call(store, fixture(), "GET", "/account/legal");
    expect(res.json().pending).toEqual([]);
    expect(res.json().documents.find((doc) => doc.doc === "consent")).toMatchObject({
      accepted: true,
      acceptedAt: "2026-11-20T10:00:00.000Z",
      withdrawable: true,
    });
  });

  it("treats a withdrawal as the current state", async () => {
    const store = fakeStore([
      accepted("offer", OFFER_HASH),
      accepted("consent", CONSENT_HASH),
      { ...accepted("consent", CONSENT_HASH), event: "withdraw", accepted_at: "2026-11-21T10:00:00.000Z" },
    ]);
    const res = await call(store, fixture(), "GET", "/account/legal");
    const consent = res.json().documents.find((doc) => doc.doc === "consent");
    expect(consent.accepted).toBe(false);
    expect(consent.withdrawnAt).toBe("2026-11-21T10:00:00.000Z");
    // The consent is reaccept: true, so withdrawal also opens the blocking window again.
    expect(res.json().pending).toContain("consent");
  });
});

describe("POST /account/legal", () => {
  it("writes the registry revision, not the request values", async () => {
    const store = fakeStore();
    const res = await call(store, fixture(), "POST", "/account/legal", {
      acceptances: [{ doc: "offer", version: 1, sha256: OFFER_HASH }],
    });
    expect(res.status).toBe(200);
    expect(store.calls).toEqual([
      [{ zone: "ru", doc: "offer", version: 1, sha256: OFFER_HASH, event: "accept" }],
    ]);
    expect(res.json().documents.find((doc) => doc.doc === "offer").accepted).toBe(true);
  });

  it("refuses a stale revision with the current documents", async () => {
    const store = fakeStore();
    const res = await call(store, fixture(), "POST", "/account/legal", {
      acceptances: [{ doc: "offer", version: 1, sha256: "f".repeat(64) }],
    });
    expect(res.status).toBe(400);
    expect(res.json()).toMatchObject({ error: "LEGAL_VERSION_CHANGED" });
    expect(res.json().documents).toEqual([{ doc: "offer", version: 1, sha256: OFFER_HASH }]);
    expect(store.calls).toEqual([]);
  });

  it("refuses a document this installation does not publish", async () => {
    const res = await call(fakeStore(), fixture(), "POST", "/account/legal", {
      acceptances: [{ doc: "terms", version: 1, sha256: OFFER_HASH }],
    });
    expect(res.status).toBe(422);
    expect(res.json().error).toBe("LEGAL_DOCUMENT_UNKNOWN");
  });

  it("refuses an empty list", async () => {
    const res = await call(fakeStore(), fixture(), "POST", "/account/legal", { acceptances: [] });
    expect(res.status).toBe(400);
    expect(res.json().error).toBe("LEGAL_ACCEPTANCE_REQUIRED");
  });
});

describe("POST /account/legal/withdraw", () => {
  it("records the revision it withdraws", async () => {
    const store = fakeStore([accepted("consent", CONSENT_HASH)]);
    const res = await call(store, fixture(), "POST", "/account/legal/withdraw", { doc: "consent" });
    expect(res.status).toBe(200);
    expect(res.json().changed).toBe(true);
    expect(store.calls).toEqual([
      [{ zone: "ru", doc: "consent", version: 1, sha256: CONSENT_HASH, event: "withdraw" }],
    ]);
  });

  it("has no button for a document the index does not allow", async () => {
    const store = fakeStore([accepted("offer", OFFER_HASH)]);
    const res = await call(store, fixture(), "POST", "/account/legal/withdraw", { doc: "offer" });
    expect(res.status).toBe(403);
    expect(res.json().error).toBe("LEGAL_WITHDRAW_NOT_ALLOWED");
    expect(store.calls).toEqual([]);
  });

  it("is idempotent when there is nothing to withdraw", async () => {
    const store = fakeStore();
    const res = await call(store, fixture(), "POST", "/account/legal/withdraw", { doc: "consent" });
    expect(res.status).toBe(200);
    expect(res.json().changed).toBe(false);
    expect(store.calls).toEqual([]);
  });
});
