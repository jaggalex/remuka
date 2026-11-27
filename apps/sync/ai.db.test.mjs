/**
 * Schema 27 against a real database (ADR-251): `ai_runs.gateway_provider` lands, the
 * insert writes it, and a chain that mixes a gateway call with a direct one verifies.
 *
 * The pure hash rules live in `ai-log.test.mjs`; this proves the column and the SQL.
 */
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { verifyAiChain } from "./ai-log.mjs";
import { testDatabaseStore } from "./test-db.mjs";

const opened = await testDatabaseStore("ai journal");
const store = opened?.store ?? null;

const suite = store ? describe : describe.skip;

afterAll(async () => {
  if (store) await store.close();
});

import { journalCsv } from "./ai-journal-export.mjs";

function run(orgId, overrides = {}) {
  const at = new Date().toISOString();
  return {
    orgId,
    agentId: null,
    taskId: null,
    ownerId: null,
    boardId: null,
    skill: "diagram",
    skillVersion: 1,
    capabilities: [],
    aclVersion: 1,
    provider: "gateway",
    model: "model",
    credentialId: null,
    keyFingerprint: null,
    temperature: 0.2,
    maxTokens: 10,
    toolset: [],
    promptHash: "prompt",
    inputObjectIds: [],
    promptTokens: 1,
    completionTokens: 1,
    costUsd: 0.000001,
    latencyMs: 5,
    status: "ok",
    startedAt: at,
    finishedAt: at,
    ...overrides,
  };
}

suite("ai_runs.gateway_provider", () => {
  it("stores the gateway provider and keeps a mixed chain verifiable", async () => {
    const orgId = randomUUID();
    await store.pool.query("insert into orgs (id, name, slug) values ($1, $2, $3)", [
      orgId,
      "AI journal",
      `ai-journal-${orgId}`,
    ]);

    await store.withTenant(orgId, async () => {
      await store.appendAiRun(run(orgId, { gatewayProvider: "openrouter" }));
      await store.appendAiRun(run(orgId, { provider: "env", gatewayProvider: null }));
    });

    const rows = await store.withTenant(orgId, () => store.aiRunsForVerify(orgId));
    expect(rows.map((row) => row.gateway_provider)).toEqual(["openrouter", null]);
    expect(verifyAiChain(rows)).toMatchObject({ ok: true, checked: 2 });

    const otherOrg = randomUUID();
    const empty = await store.withTenant(otherOrg, () => store.aiJournalSummary(otherOrg));
    expect(empty).toMatchObject({ calls: 0, through: "0" });
    const summary = await store.withTenant(orgId, () => store.aiJournalSummary(orgId));
    expect(summary).toMatchObject({ calls: 2, through: "2" });
    expect(Number(summary.costUsd)).toBeCloseTo(0.000002, 8);
    // Keep an upper bound even if new calls arrive while the file is downloaded.
    const csv = await store.withTenant(orgId, async () => {
      const lines = [];
      for await (const line of journalCsv(store, orgId, "1")) lines.push(line);
      return lines;
    });
    expect(csv).toHaveLength(2);
    expect(csv[0]).toContain("key_fingerprint");
    expect(csv[1]).toContain(rows[0].hash);
    expect(csv[1]).not.toContain(rows[1].hash);

    const listed = await store.withTenant(orgId, () => store.listAiRuns(orgId, 10));
    expect(listed.map((row) => row.gateway_provider)).toEqual([null, "openrouter"]);
  });
});
