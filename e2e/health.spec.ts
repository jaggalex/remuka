import { expect, test } from "@playwright/test";
import { SCHEMA_VERSION } from "../apps/sync/schema-version.mjs";

/**
 * The probe is reachable without a session and reports the build and the product name.
 *
 * A load balancer needs one bit; whoever operates the deployment needs to know which
 * version answered, and the public name is branding anyone may read (ADR-254). The store
 * version, board and room counts and a raw driver error stay in metrics — the internet
 * has no business seeing them.
 */
test("the health probe reports ok, the build identity and the public name", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(Object.keys(body).sort()).toEqual(["build", "commit", "name", "ok", "schema", "version"]);
  expect(body.ok).toBe(true);
  expect(typeof body.name).toBe("string");
  expect(body.name).not.toBe("");
  expect(typeof body.version).toBe("string");
  expect(body.version).not.toBe("");
  expect(typeof body.build).toBe("string");
  expect(body.build).not.toBe("");
  expect(typeof body.commit).toBe("string");
  expect(body.commit).not.toBe("");
  expect(body.schema).toBe(SCHEMA_VERSION);
});

/**
 * The browser needs the installation's own name before it can say it in Russian or in
 * English; `null` means “use the brand” (ADR-254 §3).
 */
test("the config route offers the installation's own name or null", async ({ request }) => {
  const response = await request.get("/api/config");
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(Object.keys(body)).toEqual(["productName"]);
  expect(body.productName === null || typeof body.productName === "string").toBe(true);
});
