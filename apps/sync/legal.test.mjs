/**
 * The legal registry of a running installation (ADR-256 §4).
 *
 * Proves the decisions that are easy to get subtly wrong: only the installation's zone is
 * published, a draft's hash is computed rather than invented, a missing or stale
 * acceptance is refused with the right code, the journal rows come from the registry and
 * not from the request, and the address policy follows the zone unless the operator says
 * otherwise.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { legalTextSha256 } from "@remo/legal";
import {
  DEFAULT_RU_IP_RETENTION_DAYS,
  assertLegalDrafts,
  createLegalIpRetention,
  legalAcceptanceProblem,
  legalAcceptanceRows,
  legalConfig,
  legalIpPolicy,
  legalPolicyUrl,
  pendingAcceptanceDocuments,
  resolveLegal,
} from "./legal.mjs";

const OFFER = "# Оферта\n\nТекст оферты.\n";
const CONSENT = "# Согласие\n\nТекст согласия.\n";
const TERMS = "# Terms\n\nTerms text.\n";
const OFFER_HASH = legalTextSha256(OFFER);
const CONSENT_HASH = legalTextSha256(CONSENT);
const TERMS_HASH = legalTextSha256(TERMS);

function entry(overrides = {}) {
  return {
    zone: "ru",
    doc: "offer",
    title: { ru: "Оферта" },
    current: 1,
    status: "published",
    effective: "2026-12-01",
    required: "signup",
    reaccept: true,
    lang: ["ru"],
    ...overrides,
  };
}

function fixture(documents, files) {
  const root = mkdtempSync(join(tmpdir(), "legal-runtime-"));
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

function ruFixture() {
  return fixture(
    [
      entry({ sha256: { 1: OFFER_HASH } }),
      entry({
        doc: "consent",
        title: { ru: "Согласие" },
        sha256: { 1: CONSENT_HASH },
      }),
      entry({
        doc: "privacy",
        title: { ru: "Политика" },
        required: "none",
        reaccept: false,
        sha256: { 1: legalTextSha256("# Политика\n\nТекст.\n") },
      }),
      entry({
        zone: "eu",
        doc: "terms",
        title: { en: "Terms" },
        effective: "2026-12-01",
        lang: ["en"],
        sha256: { 1: TERMS_HASH },
      }),
    ],
    {
      "ru/offer/1.ru.md": OFFER,
      "ru/consent/1.ru.md": CONSENT,
      "ru/privacy/1.ru.md": "# Политика\n\nТекст.\n",
      "eu/terms/1.en.md": TERMS,
    },
  );
}

function resolveRu(root) {
  return resolveLegal(
    { REMO_COMPLIANCE_ZONE: "ru" },
    { zone: "ru", origin: "https://app.remuka.ru", cwd: root },
  );
}

const acceptance = (doc, version = 1, sha256 = OFFER_HASH) => ({ doc, version, sha256 });

describe("the registry of one installation (ADR-256 §4)", () => {
  it("publishes only this zone, with the hash of the current revision", () => {
    const legal = resolveRu(ruFixture());
    expect(legal.zone).toBe("ru");
    expect(legal.documents.map((document) => `${document.zone}/${document.doc}`)).toEqual([
      "ru/offer",
      "ru/consent",
      "ru/privacy",
    ]);
    expect(legal.documents[0]).toMatchObject({
      doc: "offer",
      zone: "ru",
      version: 1,
      sha256: OFFER_HASH,
      required: "signup",
      reaccept: true,
      status: "published",
      url: "https://app.remuka.ru/legal/offer",
    });
  });

  it("has no documents in the none zone, and no address either", () => {
    const legal = resolveLegal({ REMO_COMPLIANCE_ZONE: "none" }, { cwd: "/nonexistent" });
    expect(legalConfig(legal)).toEqual({ documents: [] });
    expect(legal.ipPolicy).toEqual({ storeIp: false, retentionDays: 0 });
  });

  it("computes the hash of a draft without recording it", () => {
    const root = fixture(
      [entry({ status: "draft", effective: null })],
      { "ru/offer/1.ru.md": OFFER },
    );
    const legal = resolveRu(root);
    // The index stays the registry: the runtime reads the draft's bytes, it does not
    // write a hash for a text that may still change.
    expect(legal.documents[0].sha256).toBe(OFFER_HASH);
    expect(legal.documents[0].status).toBe("draft");
  });

  it("refuses to start a named zone without the registry", () => {
    expect(() =>
      resolveLegal(
        { REMO_COMPLIANCE_ZONE: "ru" },
        { zone: "ru", cwd: join(tmpdir(), "does-not-exist-remo") },
      ),
    ).toThrow(/content\/legal\/index\.json not found/);
  });
});

describe("sign-up acceptance (§4)", () => {
  it("needs every required document of the zone", () => {
    const legal = resolveRu(ruFixture());
    const problem = legalAcceptanceProblem(legal, [acceptance("offer")]);
    expect(problem).toMatchObject({
      code: "LEGAL_ACCEPTANCE_REQUIRED",
      missing: ["consent"],
    });
    expect(problem.documents).toEqual([
      { doc: "offer", version: 1, sha256: OFFER_HASH },
      { doc: "consent", version: 1, sha256: CONSENT_HASH },
    ]);
    expect(legalAcceptanceProblem(legal, undefined)).toMatchObject({
      code: "LEGAL_ACCEPTANCE_REQUIRED",
      missing: ["offer", "consent"],
    });
  });

  it("refuses an old hash or an old revision as changed", () => {
    const legal = resolveRu(ruFixture());
    expect(
      legalAcceptanceProblem(legal, [
        acceptance("offer", 1, "0".repeat(64)),
        acceptance("consent", 1, CONSENT_HASH),
      ]),
    ).toMatchObject({ code: "LEGAL_VERSION_CHANGED" });
    expect(
      legalAcceptanceProblem(legal, [
        acceptance("offer", 2, OFFER_HASH),
        acceptance("consent", 1, CONSENT_HASH),
      ]),
    ).toMatchObject({ code: "LEGAL_VERSION_CHANGED" });
  });

  it("refuses a document that belongs to another zone", () => {
    const legal = resolveRu(ruFixture());
    const problem = legalAcceptanceProblem(legal, [acceptance("terms", 1, TERMS_HASH)]);
    expect(problem).toMatchObject({
      code: "LEGAL_ACCEPTANCE_REQUIRED",
      missing: ["offer", "consent"],
    });
  });

  it("accepts the current revisions and writes rows from the registry only", () => {
    const legal = resolveRu(ruFixture());
    const acceptances = [
      acceptance("offer"),
      acceptance("consent", 1, CONSENT_HASH),
      // An extra document is not a row: the server writes what it asked for.
      acceptance("privacy", 1, legalTextSha256("# Политика\n\nТекст.\n")),
      { doc: "unpublished", version: 99, sha256: "f".repeat(64) },
    ];
    expect(legalAcceptanceProblem(legal, acceptances)).toBeNull();
    expect(legalAcceptanceRows(legal)).toEqual([
      { zone: "ru", doc: "offer", version: 1, sha256: OFFER_HASH },
      { zone: "ru", doc: "consent", version: 1, sha256: CONSENT_HASH },
    ]);
  });

  it("asks nothing in the none zone", () => {
    const legal = resolveLegal({}, { zone: "none" });
    expect(legalAcceptanceProblem(legal, null)).toBeNull();
    expect(legalAcceptanceRows(legal)).toEqual([]);
  });
});

describe("re-acceptance pending documents (§5)", () => {
  const documents = () => resolveRu(ruFixture()).documents;
  // The fixture's revisions take effect on 2026-12-01; the window is due from that day.
  const inForce = new Date("2026-12-01T00:00:00Z");

  it("asks an account that never accepted anything for every sign-up document", () => {
    expect(
      pendingAcceptanceDocuments({ documents: documents() }, [], inForce).map((doc) => doc.doc),
    ).toEqual(["offer", "consent"]);
  });

  it("is quiet when the current revision is the latest acceptance", () => {
    const rows = [
      { doc: "offer", zone: "ru", version: 1, sha256: OFFER_HASH, event: "accept" },
      { doc: "consent", zone: "ru", version: 1, sha256: CONSENT_HASH, event: "accept" },
    ];
    expect(pendingAcceptanceDocuments({ documents: documents() }, rows, inForce)).toEqual([]);
  });

  it("asks again after a withdrawal and never for a document without reaccept", () => {
    const rows = [
      { doc: "offer", zone: "ru", version: 1, sha256: OFFER_HASH, event: "accept" },
      { doc: "consent", zone: "ru", version: 1, sha256: CONSENT_HASH, event: "withdraw" },
      { doc: "privacy", zone: "ru", version: 1, sha256: "f".repeat(64), event: "accept" },
    ];
    expect(
      pendingAcceptanceDocuments({ documents: documents() }, rows, inForce).map((doc) => doc.doc),
    ).toEqual(["consent"]);
  });

  it("waits for a future effective date: the banner announces it, not the window", () => {
    expect(
      pendingAcceptanceDocuments(
        { documents: documents() },
        [],
        new Date("2026-11-01T00:00:00Z"),
      ),
    ).toEqual([]);
    expect(
      pendingAcceptanceDocuments(
        { documents: documents() },
        [],
        new Date("2026-12-02T00:00:00Z"),
      ).map((document) => document.doc),
    ).toEqual(["offer", "consent"]);
  });
});

describe("the policy link of an invitation (§6)", () => {
  it("prefers the operator's own address, then the zone's privacy page, then the apex", () => {
    const legal = resolveRu(ruFixture());
    const configured = "https://boards.example.com/legal/privacy";
    expect(
      legalPolicyUrl({ legal, env: { REMO_COOKIE_POLICY_URL: configured } }),
    ).toBe(configured);
    expect(legalPolicyUrl({ legal, env: {} })).toBe("https://app.remuka.ru/legal/privacy");
    expect(
      legalPolicyUrl({ legal: { zone: "eu", documents: [] }, env: {} }),
    ).toBe("https://remuka.com/legal/privacy");
    expect(legalPolicyUrl({ legal: { zone: "none", documents: [] }, env: {} })).toBeNull();
    expect(
      legalPolicyUrl({
        legal: { zone: "none", documents: [] },
        env: { REMO_COOKIE_POLICY_URL: configured },
      }),
    ).toBeNull();
  });
});

describe("the production draft guard (§2)", () => {
  const draft = () => resolveRu(fixture([entry({ status: "draft", effective: null })], {
    "ru/offer/1.ru.md": OFFER,
  }));

  it("stops a production start with a required draft", () => {
    expect(() => assertLegalDrafts(draft(), { NODE_ENV: "production" })).toThrow(
      /required document\(s\) still drafts: ru\/offer/,
    );
  });

  it("allows the documented test stand and every non-production start", () => {
    expect(() =>
      assertLegalDrafts(draft(), {
        NODE_ENV: "production",
        REMO_STAGE: "1",
        REMO_LEGAL_ALLOW_DRAFTS: "1",
      }),
    ).not.toThrow();
    expect(() => assertLegalDrafts(draft(), { NODE_ENV: "development" })).not.toThrow();
  });

  it("refuses the drafts flag without the stage flag even on a production start", () => {
    expect(() =>
      assertLegalDrafts(draft(), {
        NODE_ENV: "production",
        REMO_LEGAL_ALLOW_DRAFTS: "1",
      }),
    ).toThrow(/only together with REMO_STAGE=1/);
    // The flag itself is the mistake, so even a published registry does not hide it.
    expect(() =>
      assertLegalDrafts({ zone: "ru", documents: [] }, {
        NODE_ENV: "production",
        REMO_LEGAL_ALLOW_DRAFTS: "1",
      }),
    ).toThrow(/REMO_STAGE=1/);
  });
});

describe("the address policy (§4)", () => {
  it("keeps no address in the EU and the Russian default for three years", () => {
    expect(legalIpPolicy({}, "eu")).toEqual({ storeIp: false, retentionDays: 0 });
    expect(legalIpPolicy({}, "ru")).toEqual({
      storeIp: true,
      retentionDays: DEFAULT_RU_IP_RETENTION_DAYS,
    });
    expect(DEFAULT_RU_IP_RETENTION_DAYS).toBe(1095);
  });

  it("obeys the two settings in both directions", () => {
    expect(legalIpPolicy({ REMO_LEGAL_STORE_IP: "0" }, "ru")).toEqual({
      storeIp: false,
      retentionDays: 1095,
    });
    // An enabled switch cannot outvote an explicit zero-day retention.
    expect(legalIpPolicy({ REMO_LEGAL_STORE_IP: "1" }, "eu")).toEqual({
      storeIp: false,
      retentionDays: 0,
    });
    expect(
      legalIpPolicy(
        { REMO_LEGAL_STORE_IP: "1", REMO_LEGAL_IP_RETENTION_DAYS: "30" },
        "eu",
      ),
    ).toEqual({ storeIp: true, retentionDays: 30 });
    expect(
      legalIpPolicy({ REMO_LEGAL_IP_RETENTION_DAYS: "0" }, "ru"),
    ).toEqual({ storeIp: false, retentionDays: 0 });
  });

  it("stops the start instead of guessing at a typo", () => {
    expect(() => legalIpPolicy({ REMO_LEGAL_STORE_IP: "yes" }, "eu")).toThrow(
      /REMO_LEGAL_STORE_IP must be 0 or 1/,
    );
    for (const days of ["-1", "1.5", "many", "1d"]) {
      expect(
        () => legalIpPolicy({ REMO_LEGAL_IP_RETENTION_DAYS: days }, "ru"),
        days,
      ).toThrow(/REMO_LEGAL_IP_RETENTION_DAYS/);
    }
  });

  it("clears digests older than the retention period and nothing else", async () => {
    const clearLegalIpBefore = vi.fn(async () => 3);
    const now = () => new Date("2026-11-22T00:00:00Z");
    const job = createLegalIpRetention({
      store: { clearLegalIpBefore },
      policy: { storeIp: true, retentionDays: 1095 },
      now,
      log: { error() {} },
    });
    await expect(job.runOnce()).resolves.toBe(3);
    expect(clearLegalIpBefore).toHaveBeenCalledWith(
      new Date(Date.parse("2026-11-22T00:00:00Z") - 1095 * 86400000),
    );

    const off = createLegalIpRetention({
      store: { clearLegalIpBefore },
      policy: { storeIp: false, retentionDays: 0 },
      now,
    });
    clearLegalIpBefore.mockClear();
    await expect(off.runOnce()).resolves.toBe(0);
    expect(clearLegalIpBefore).not.toHaveBeenCalled();
  });
});
