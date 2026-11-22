import { Readable } from "node:stream";
import { beforeEach, describe, expect, it } from "vitest";
import { resetFailures } from "./attempts.mjs";
import { base32Encode, totpCode, totpStep } from "./mfa.mjs";
import {
  OPERATOR_MFA_READ_MS,
  OPERATOR_STEP_UP_MS,
  assertOperatorStepUp,
  handleOperatorConsole,
  operatorMfaReadFresh,
  operatorStepUpFresh,
} from "./operator-console-api.mjs";

/**
 * The console's server rules (ADR-259 §5, ADR-260 §6): a non-operator sees 404, a read
 * needs a code no older than twelve hours, a changing action needs one no older than
 * fifteen minutes, and every route is answered by one module so no screen grows its own
 * permission check.
 */
const OPERATOR_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";
const SECRET = base32Encode(Buffer.alloc(20, 7));

function fakeResponse() {
  const out = { status: 0, body: null, headers: {} };
  return {
    out,
    headers: out.headers,
    writeHead(status, headers = {}) {
      out.status = status;
      Object.assign(out.headers, headers);
    },
    setHeader(name, value) {
      out.headers[name.toLowerCase()] = value;
    },
    getHeader(name) {
      return out.headers[name.toLowerCase()];
    },
    end(text) {
      out.body = text ? JSON.parse(text) : null;
    },
  };
}

function fakeRequest({ method = "GET", cookie = "remo_session=token", body = null } = {}) {
  const stream = body === null ? Readable.from([]) : Readable.from([Buffer.from(JSON.stringify(body))]);
  stream.method = method;
  stream.headers = cookie ? { cookie } : {};
  return stream;
}

function store({
  operator = true,
  enrolled = true,
  mfaAt = new Date(),
  recoveryLeft = 10,
} = {}) {
  const calls = [];
  const state = {
    mfaAt,
    challenges: new Map(),
    lastStep: null,
  };
  return {
    calls,
    state,
    async findSession(tokenHash) {
      calls.push(["session", Buffer.from(tokenHash).length]);
      return {
        id: "33333333-3333-4333-8333-333333333333",
        user_id: OPERATOR_ID,
        email: "ops@example.test",
        name: "Ops",
        handle: "ops",
        state: "active",
        email_verified_at: new Date(),
        theme: null,
        lang: "ru",
        operator_confirmed_at: state.mfaAt,
        mfa_at: state.mfaAt,
      };
    },
    touchSession() {
      return Promise.resolve();
    },
    async isInstanceOperator(id) {
      calls.push(["operator", id]);
      return operator && id === OPERATOR_ID;
    },
    async mfaStatus() {
      calls.push(["mfaStatus"]);
      return {
        enrolled,
        pending: false,
        confirmedAt: enrolled ? new Date("2026-11-01T00:00:00Z") : null,
        recoveryLeft,
      };
    },
    async createMfaChallenge({ tokenHash, purpose, userId, expiresAt }) {
      calls.push(["createChallenge", purpose]);
      const id = `challenge-${state.challenges.size + 1}`;
      state.challenges.set(Buffer.from(tokenHash).toString("hex"), {
        id,
        user_id: userId,
        purpose,
        attempts: 0,
        expires_at: expiresAt,
      });
      return { id, expires_at: expiresAt };
    },
    async findMfaChallenge(tokenHash) {
      return state.challenges.get(Buffer.from(tokenHash).toString("hex")) ?? null;
    },
    async failMfaChallenge(id) {
      for (const [key, row] of state.challenges) {
        if (row.id !== id) continue;
        row.attempts += 1;
        const deleted = row.attempts >= 5;
        if (deleted) state.challenges.delete(key);
        return { attempts: row.attempts, deleted };
      }
      return { attempts: 0, deleted: true };
    },
    async deleteMfaChallenge(tokenHash) {
      state.challenges.delete(Buffer.from(tokenHash).toString("hex"));
    },
    async verifyMfaCode({ code, now }) {
      const step = totpStep(now);
      if (code !== totpCode(SECRET, step)) return { ok: false, reason: "mismatch" };
      if (state.lastStep !== null && step <= state.lastStep) {
        return { ok: false, reason: "replayed", step };
      }
      state.lastStep = step;
      return { ok: true, step };
    },
    async verifyMfaRecoveryCode() {
      return { ok: false, reason: "mismatch" };
    },
    async setSessionMfaAt(sessionId, at) {
      calls.push(["mfaAt", sessionId]);
      state.mfaAt = at;
    },
    async confirmOperatorSession() {
      calls.push(["confirm"]);
      return state.mfaAt;
    },
    async recordAudit(event) {
      calls.push(["audit", event]);
    },
    async searchOperatorCustomers(query) {
      calls.push(["search", query]);
      return [{ kind: "user", id: OPERATOR_ID, label: "ops@example.test", detail: "Ops", slug: null }];
    },
    async operatorCustomerByOrg(id) {
      calls.push(["card", id]);
      return { user: null, orgs: [{ id, name: "Studio", slug: "studio" }] };
    },
    async operatorPulseOrgs() {
      return [];
    },
    async operatorPulseSubscriptions() {
      return [
        {
          orgId: ORG_ID,
          plan: "team",
          amount: 59000,
          currency: "RUB",
          interval: "month",
          status: "active",
        },
      ];
    },
    async operatorPulseInvitationsSince() {
      return 0;
    },
    async operatorMailDeadSince() {
      return 0;
    },
    async operatorJournal(filters) {
      calls.push(["journal", filters]);
      return [{ id: "1", action: "billing.refunded", actorEmail: "ops@example.test" }];
    },
  };
}

async function call(path, { method = "GET", body = null, fake = null, active = null } = {}) {
  const response = fakeResponse();
  const handled = await handleOperatorConsole({
    request: fakeRequest({ method, body }),
    response,
    url: new URL(`http://localhost${path}`),
    store: active ?? fake,
    env: { REMO_KEK: Buffer.alloc(32, 1).toString("base64"), REMO_KEK_ID: "test" },
    log: { error() {} },
  });
  return { handled, ...response.out };
}

beforeEach(() => resetFailures());

describe("the operator console surface", () => {
  it("answers 404 to a signed-out visitor and to a signed-in non-operator", async () => {
    const guest = await call("/operator/pulse", { active: null });
    expect(guest.status).toBe(404);

    const customer = store();
    const denied = await call("/operator/pulse", {
      fake: customer,
      active: { ...customer, isInstanceOperator: async () => false },
    });
    expect(denied.status).toBe(404);
  });

  it("treats an unknown path under /operator as 404 even for an operator", async () => {
    const active = store();
    const { status, handled } = await call("/operator/nope", { fake: active });
    expect(handled).toBe(true);
    expect(status).toBe(404);
  });

  it("names the session and its second-factor state", async () => {
    const active = store();
    const { status, body } = await call("/operator/session", { fake: active });
    expect(status).toBe(200);
    expect(body.operator.email).toBe("ops@example.test");
    expect(body.enrolled).toBe(true);
    expect(body.recoveryLeft).toBe(10);
    expect(body.mfaAt).toBeTruthy();
    expect(body.stepUpMs).toBe(OPERATOR_STEP_UP_MS);
    expect(body.readMs).toBe(OPERATOR_MFA_READ_MS);
  });

  it("refuses a read without a fresh code and hands out a step-up challenge", async () => {
    const active = store({ mfaAt: null });
    const denied = await call("/operator/pulse", { fake: active });
    expect(denied.status).toBe(403);
    expect(denied.body.error).toBe("MFA_REQUIRED");
    expect(denied.body.mfaRequired).toBe(true);
    expect(typeof denied.body.challenge).toBe("string");
    expect(active.state.challenges.size).toBe(1);
    expect([...active.state.challenges.values()][0].purpose).toBe("step_up");
  });

  it("refuses an enrolled-less operator with enrolment, not with a code prompt", async () => {
    const active = store({ enrolled: false, mfaAt: null });
    const denied = await call("/operator/session", { fake: active });
    expect(denied.status).toBe(403);
    expect(denied.body.enrollmentRequired).toBe(true);
    expect(denied.body.challenge).toBeUndefined();
  });

  it("accepts a code, records mfa_at and the step-up audit row", async () => {
    const active = store({ mfaAt: null });
    const denied = await call("/operator/session", { fake: active });
    const { challenge } = denied.body;
    const now = new Date();
    const ok = await call("/operator/session/confirm", {
      method: "POST",
      body: { challenge, code: totpCode(SECRET, totpStep(now)) },
      fake: active,
    });
    expect(ok.status).toBe(200);
    expect(ok.body.mfaAt).toBeTruthy();
    expect(active.state.mfaAt).toBeTruthy();
    const audits = active.calls.filter(([name]) => name === "audit").map(([, event]) => event.action);
    expect(audits).toContain("mfa.step_up");

    // The same code is spent: the console now opens with the stored mfa_at.
    const again = await call("/operator/session", { fake: active });
    expect(again.status).toBe(200);
  });

  it("refuses a wrong code and does not refresh the session", async () => {
    const active = store({ mfaAt: null });
    const denied = await call("/operator/session", { fake: active });
    const wrong = await call("/operator/session/confirm", {
      method: "POST",
      body: { challenge: denied.body.challenge, code: "000000" },
      fake: active,
    });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error).toBe("MFA_INVALID");
    expect(active.state.mfaAt).toBeNull();
  });

  it("returns the pulse with an honest reason where the metrics database is absent", async () => {
    const active = store();
    const { status, body } = await call("/operator/pulse?weeks=4", { fake: active });
    expect(status).toBe(200);
    expect(body.weeks).toBe(4);
    // The product store's subscription rows are not a source any more (§4.6).
    const mrr = body.tiles.find((tile) => tile.id === "mrr");
    expect(mrr.value).toBeNull();
    expect(mrr.reason).toMatch(/metrics database/);
    const wact = body.tiles.find((tile) => tile.id === "wact");
    expect(wact.value).toBeNull();
    expect(wact.reason).toMatch(/metrics database/);
    expect(body.money.mrrByCurrency).toEqual([]);
  });

  it("searches customers and reads a card without room names", async () => {
    const active = store();
    const search = await call("/operator/customers?q=ops", { fake: active });
    expect(search.status).toBe(200);
    expect(search.body.matches).toHaveLength(1);

    const card = await call(`/operator/customers/org/${ORG_ID}`, { fake: active });
    expect(card.status).toBe(200);
    expect(card.body.orgs[0].name).toBe("Studio");
    expect(JSON.stringify(card.body)).not.toMatch(/boards|room/i);
  });

  it("refuses a journal filter that is not an id", async () => {
    const active = store();
    const { status } = await call("/operator/journal?actor=not-a-uuid", { fake: active });
    expect(status).toBe(400);
  });
});

describe("the second-factor clock", () => {
  it("accepts a code inside twelve hours for reading and refuses an older one", () => {
    const at = new Date("2026-11-23T00:00:00Z");
    expect(operatorMfaReadFresh(at, at.getTime() + 11 * 60 * 60_000)).toBe(true);
    expect(operatorMfaReadFresh(at, at.getTime() + 13 * 60 * 60_000)).toBe(false);
    expect(operatorMfaReadFresh(null)).toBe(false);
  });

  it("accepts a confirmation inside fifteen minutes and refuses an older one", () => {
    const at = new Date("2026-11-23T10:00:00Z");
    expect(operatorStepUpFresh(at, at.getTime() + 14 * 60_000)).toBe(true);
    expect(operatorStepUpFresh(at, at.getTime() + 16 * 60_000)).toBe(false);
    expect(operatorStepUpFresh(null)).toBe(false);
  });

  it("throws the one refusal code a changing route will report", () => {
    expect(() => assertOperatorStepUp({ mfaAt: new Date() })).not.toThrow();
    try {
      assertOperatorStepUp({ mfaAt: null });
      throw new Error("expected a refusal");
    } catch (error) {
      expect(error.code).toBe("MFA_REQUIRED");
    }
  });
});
