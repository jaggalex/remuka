import { describe, expect, it } from "vitest";
import { json, refuseSecondFactor } from "./iam-http.mjs";

/** The minimum of ServerResponse that `json` touches. */
function response() {
  const headers = {};
  return {
    headers,
    status: 0,
    body: "",
    getHeader(name) {
      return headers[name];
    },
    setHeader(name, value) {
      headers[name] = value;
    },
    writeHead(status, extra = {}) {
      this.status = status;
      Object.assign(headers, extra);
    },
    end(body) {
      this.body = body;
    },
  };
}

describe("the JSON response helper", () => {
  it("keeps a cookie a handler already queued", () => {
    // A request may carry a CSRF cookie and a handler-set session cookie. Overwriting
    // `Set-Cookie` would drop one of them, and the CSRF pair would break (ADR-062).
    const res = response();
    res.setHeader("Set-Cookie", ["session=abc"]);
    json(res, 200, { ok: true }, { "Set-Cookie": "csrf=token" });

    expect(res.headers["Set-Cookie"]).toEqual(["session=abc", "csrf=token"]);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
  });

  it("sets the content type and does not invent a cookie", () => {
    const res = response();
    json(res, 204, { ok: true });
    expect(res.headers["Content-Type"]).toBe("application/json");
    expect(res.headers["Set-Cookie"]).toBeUndefined();
  });
});

describe("the second-factor refusal", () => {
  it("answers 401 for a wrong code and 429 for a dead challenge or a locked account", () => {
    const invalid = response();
    refuseSecondFactor(invalid, { reason: "invalid" });
    expect(invalid.status).toBe(401);
    expect(JSON.parse(invalid.body).error).toBe("MFA_INVALID");

    const locked = response();
    refuseSecondFactor(locked, { reason: "locked" });
    expect(locked.status).toBe(429);
    expect(JSON.parse(locked.body)).toMatchObject({ error: "MFA_LOCKED", reason: "account" });
    expect(locked.headers["Retry-After"]).toBe("3600");

    // Five wrong answers end the challenge, not the account: no hour-long wait.
    const exhausted = response();
    refuseSecondFactor(exhausted, { reason: "exhausted" });
    expect(exhausted.status).toBe(429);
    expect(exhausted.headers["Retry-After"]).toBeUndefined();
    expect(JSON.parse(exhausted.body).reason).toBe("challenge");
  });

  it("counts every refusal and the clock-skew signal separately", () => {
    const counted = [];
    refuseSecondFactor(response(), { reason: "invalid", clockSkew: true }, {
      metrics: { inc: (name) => counted.push(name) },
    });
    expect(counted).toEqual(["remo_mfa_clock_skew_rejects_total", "remo_mfa_rejects_total"]);

    const plain = [];
    refuseSecondFactor(response(), { reason: "invalid" }, {
      metrics: { inc: (name) => plain.push(name) },
    });
    expect(plain).toEqual(["remo_mfa_rejects_total"]);
  });
});
