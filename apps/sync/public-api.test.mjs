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

const BUILD = { version: "0.8.0", build: "1", commit: "abc", schema: 27 };

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
      expect(JSON.parse(out.body)).toEqual({ productName: expected });
    }
  });

  it("keeps the health probe one bit plus the build and the name", async () => {
    const out = response();
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
