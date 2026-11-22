import { describe, expect, it } from "vitest";
import { handlePublicRoutes } from "./public-api.mjs";

function response() {
  return {
    status: 0,
    headers: {},
    body: "",
    writeHead(status, headers) {
      this.status = status;
      Object.assign(this.headers, headers);
    },
    end(body) {
      this.body = body;
    },
  };
}

const BUILD = { version: "0.8.0", build: "1", commit: "abc", schema: 28 };
const NONE = { zone: "none", policyUrl: null, personalDataConsentUrl: null };
const NO_LEGAL = { documents: [] };

describe("public routes (ADR-254 §3)", () => {
  it("offers the installation's own name or null", async () => {
    for (const [override, expected] of [
      ["Acme Boards", "Acme Boards"],
      [null, null],
    ]) {
      const out = response();
      const handled = await handlePublicRoutes({
        request: { method: "GET" },
        response: out,
        url: new URL("http://sync.test/config"),
        store: {},
        build: BUILD,
        productName: override ?? "Remuka",
        productNameOverride: override,
      });
      expect(handled).toBe(true);
      expect(out.status).toBe(200);
      expect(JSON.parse(out.body)).toEqual({
        productName: expected,
        compliance: NONE,
        legal: NO_LEGAL,
      });
    }
  });

  it("always publishes a compliance zone, even when nobody passed one", async () => {
    const out = response();
    await handlePublicRoutes({
      request: { method: "GET" },
      response: out,
      url: new URL("http://sync.test/config"),
      store: {},
      build: BUILD,
      productName: "Remuka",
      productNameOverride: null,
    });
    expect(JSON.parse(out.body).compliance).toEqual(NONE);
  });

  it("publishes the zone and the policy link of the installation (ADR-255 §3)", async () => {
    for (const compliance of [
      {
        zone: "eu",
        policyUrl: "https://remuka.com/legal/cookies",
        personalDataConsentUrl: null,
      },
      {
        zone: "ru",
        policyUrl: "https://remuka.ru/legal/cookies",
        personalDataConsentUrl: "https://remuka.ru/legal/personal-data",
      },
      { zone: "eu", policyUrl: null, personalDataConsentUrl: null },
      NONE,
    ]) {
      const out = response();
      await handlePublicRoutes({
        request: { method: "GET" },
        response: out,
        url: new URL("http://sync.test/config"),
        store: {},
        build: BUILD,
        productName: "Remuka",
        productNameOverride: null,
        compliance,
      });
      expect(JSON.parse(out.body), JSON.stringify(compliance)).toEqual({
        productName: null,
        compliance,
        legal: NO_LEGAL,
      });
    }
  });

  it("publishes the legal documents of the installation (ADR-256 §4)", async () => {
    const legal = {
      documents: [
        {
          doc: "offer",
          zone: "ru",
          version: 2,
          sha256: "a".repeat(64),
          required: "signup",
          reaccept: true,
          url: "https://app.remuka.ru/legal/offer",
        },
        {
          doc: "privacy",
          zone: "ru",
          version: 1,
          sha256: "b".repeat(64),
          required: "none",
          reaccept: false,
          url: "https://app.remuka.ru/legal/privacy",
        },
      ],
    };
    const out = response();
    await handlePublicRoutes({
      request: { method: "GET" },
      response: out,
      url: new URL("http://sync.test/config"),
      store: {},
      build: BUILD,
      productName: "Remuka",
      productNameOverride: null,
      compliance: { zone: "ru", policyUrl: null, personalDataConsentUrl: null },
      legal,
    });
    expect(JSON.parse(out.body).legal).toEqual(legal);
  });

  it("adds the planned move only when both settings are valid", async () => {
    const move = { to: "https://app.remuka.com", at: "2026-12-01" };
    const out = response();
    await handlePublicRoutes({
      request: { method: "GET" },
      response: out,
      url: new URL("http://sync.test/config"),
      store: {},
      build: BUILD,
      productName: "Remuka",
      productNameOverride: null,
      move,
    });
    expect(JSON.parse(out.body)).toEqual({
      productName: null,
      compliance: NONE,
      legal: NO_LEGAL,
      move,
    });
  });

  it("publishes no move when the pair is incomplete or the date is bad", async () => {
    for (const move of [null, undefined, { to: "https://app.remuka.com" }, { to: "https://app.remuka.com", at: "" }]) {
      const out = response();
      await handlePublicRoutes({
        request: { method: "GET" },
        response: out,
        url: new URL("http://sync.test/config"),
        store: {},
        build: BUILD,
        productName: "Remuka",
        productNameOverride: null,
        move,
      });
      expect(JSON.parse(out.body), String(move)).toEqual({
        productName: null,
        compliance: NONE,
        legal: NO_LEGAL,
      });
    }
  });

  it("keeps the health probe one bit plus the build and the name", async () => {    const out = response();
    const handled = await handlePublicRoutes({
      request: { method: "GET" },
      response: out,
      url: new URL("http://sync.test/health"),
      store: { health: async () => ({ ok: true }) },
      build: BUILD,
      productName: "Remuka",
      productNameOverride: null,
    });
    expect(handled).toBe(true);
    expect(out.status).toBe(200);
    expect(JSON.parse(out.body)).toEqual({ ...BUILD, ok: true, name: "Remuka" });
  });

  it("adds stage:true to health and config only when the service is a stand", async () => {
    for (const stage of [undefined, true]) {
      const health = response();
      await handlePublicRoutes({
        request: { method: "GET" },
        response: health,
        url: new URL("http://sync.test/health"),
        store: { health: async () => ({ ok: true }) },
        build: BUILD,
        productName: "Remuka",
        productNameOverride: null,
        stage,
      });
      const healthBody = JSON.parse(health.body);
      expect("stage" in healthBody).toBe(stage === true);
      if (stage) expect(healthBody.stage).toBe(true);

      const config = response();
      await handlePublicRoutes({
        request: { method: "GET" },
        response: config,
        url: new URL("http://sync.test/config"),
        store: {},
        build: BUILD,
        productName: "Remuka",
        productNameOverride: null,
        stage,
      });
      const configBody = JSON.parse(config.body);
      expect("stage" in configBody).toBe(stage === true);
    }
  });

  it("leaves a route it does not own to the rest of the service", async () => {
    const out = response();
    const handled = await handlePublicRoutes({
      request: { method: "GET" },
      response: out,
      url: new URL("http://sync.test/boards"),
      store: {},
      build: BUILD,
      productName: "Remuka",
      productNameOverride: null,
    });
    expect(handled).toBe(false);
    expect(out.status).toBe(0);
  });
});
