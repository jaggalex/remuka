import { describe, expect, it } from "vitest";
import {
  MFA_ISSUER,
  TOTP_DIGITS,
  TOTP_PERIOD_SECONDS,
  base32Decode,
  base32Encode,
  hashRecoveryCode,
  matchTotp,
  mfaIssuer,
  newRecoveryCode,
  newRecoveryCodes,
  newTotpSecret,
  normalizeRecoveryCode,
  normalizeTotpCode,
  otpauthUri,
  totpCode,
  totpStep,
} from "./mfa.mjs";

/**
 * The acceptance table of `spec/totp.md` §11: the RFC 6238 SHA-1 vectors, the ±1 step
 * window, the replay rule and the issuer that tells two installations apart.
 *
 * The RFC prints its vectors for an ASCII secret; Base32 is only the wire format, so the
 * test encodes the same bytes the standard uses.
 */
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890", "ascii"));

describe("RFC 6238 vectors (SHA-1, 6 digits, 30 seconds)", () => {
  const vectors = [
    { time: 59, code: "287082" },
    { time: 1111111109, code: "081804" },
    { time: 1234567890, code: "005924" },
    { time: 20000000000, code: "353130" },
  ];

  for (const vector of vectors) {
    it(`T=${vector.time} is ${vector.code}`, () => {
      expect(TOTP_DIGITS).toBe(6);
      expect(TOTP_PERIOD_SECONDS).toBe(30);
      expect(totpCode(RFC_SECRET, Math.floor(vector.time / 30))).toBe(vector.code);
      // The same answer whether the caller passes the moment in seconds since the epoch or
      // a Date: one clock for the code and the decision.
      expect(matchTotp({ secret: RFC_SECRET, code: vector.code, now: vector.time * 1000 })).toEqual({
        ok: true,
        step: Math.floor(vector.time / 30),
      });
    });
  }

  it("counts steps from the Unix epoch, not from process start", () => {
    expect(totpStep(new Date("1970-01-01T00:00:00Z"))).toBe(0);
    expect(totpStep(new Date("1970-01-01T00:00:30Z"))).toBe(1);
    expect(totpStep(59_000)).toBe(1);
  });
});

describe("base32", () => {
  it("round-trips random bytes without padding", () => {
    const bytes = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    const text = base32Encode(bytes);
    expect(text).toMatch(/^[A-Z2-7]+$/);
    expect(base32Decode(text).equals(bytes)).toBe(true);
  });

  it("accepts the spacing and padding a person may paste", () => {
    expect(base32Decode("JBSW Y3DP").toString("ascii")).toBe("Hello");
    expect(base32Decode("JBSWY3DP====").toString("ascii")).toBe("Hello");
  });

  it("refuses a character outside the alphabet", () => {
    expect(() => base32Decode("JBSWY3D0")).toThrow(/invalid character/);
    expect(() => base32Decode("")).toThrow(/empty/);
  });
});

describe("a fresh secret", () => {
  it("is 20 bytes in Base32 and decodes back to them", () => {
    const secret = newTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(secret)).toHaveLength(20);
    expect(newTotpSecret()).not.toBe(secret);
  });
});

describe("the ±1 step window and the replay rule", () => {
  const moment = new Date("2026-11-23T12:00:00Z");
  const step = totpStep(moment);
  const code = (offset) => totpCode(RFC_SECRET, step + offset);

  it("accepts the current step and one neighbour each way", () => {
    for (const offset of [-1, 0, 1]) {
      expect(matchTotp({ secret: RFC_SECRET, code: code(offset), now: moment })).toEqual({
        ok: true,
        step: step + offset,
      });
    }
  });

  it("refuses two steps away and names the clock as the reason", () => {
    for (const offset of [-3, -2, 2, 3]) {
      expect(matchTotp({ secret: RFC_SECRET, code: code(offset), now: moment })).toMatchObject({
        ok: false,
        reason: "clock_skew",
        step: step + offset,
      });
    }
  });

  it("refuses the same code twice, even inside its thirty seconds", () => {
    expect(matchTotp({ secret: RFC_SECRET, code: code(0), now: moment, lastStep: step })).toEqual({
      ok: false,
      reason: "replayed",
      step,
    });
  });

  it("refuses an older step after a newer one was accepted", () => {
    // Monotonic, not "not equal": a still-valid earlier code must not reopen the window.
    expect(
      matchTotp({ secret: RFC_SECRET, code: code(-1), now: moment, lastStep: step }),
    ).toMatchObject({ ok: false, reason: "replayed" });
    expect(matchTotp({ secret: RFC_SECRET, code: code(1), now: moment, lastStep: step })).toEqual({
      ok: true,
      step: step + 1,
    });
  });

  it("refuses a malformed or simply wrong code without saying which account exists", () => {
    expect(matchTotp({ secret: RFC_SECRET, code: "12345", now: moment })).toEqual({
      ok: false,
      reason: "malformed",
    });
    expect(matchTotp({ secret: RFC_SECRET, code: "abcdef", now: moment })).toEqual({
      ok: false,
      reason: "malformed",
    });
    expect(matchTotp({ secret: RFC_SECRET, code: "000000", now: moment })).toMatchObject({
      ok: false,
      reason: "mismatch",
    });
  });

  it("accepts a code pasted with a space", () => {
    const text = code(0);
    const pasted = `${text.slice(0, 3)} ${text.slice(3)}`;
    expect(normalizeTotpCode(pasted)).toBe(text);
    expect(matchTotp({ secret: RFC_SECRET, code: pasted, now: moment })).toMatchObject({ ok: true });
  });
});

describe("the issuer names the installation", () => {
  it("uses the zone's name for the two clouds", () => {
    expect(MFA_ISSUER).toEqual({ ru: "Ремука (РФ)", eu: "Remuka (EU)" });
    expect(mfaIssuer({ REMO_COMPLIANCE_ZONE: "ru" })).toBe("Ремука (РФ)");
    expect(mfaIssuer({ REMO_COMPLIANCE_ZONE: "eu" })).toBe("Remuka (EU)");
    // Whitespace and case are environment noise, not a third installation.
    expect(mfaIssuer({ REMO_COMPLIANCE_ZONE: " EU " })).toBe("Remuka (EU)");
  });

  it("uses the installation's own name on a self-host", () => {
    expect(mfaIssuer({})).toBe("Remuka");
    expect(mfaIssuer({ REMO_PRODUCT_NAME: "Школа" })).toBe("Школа");
  });
});

describe("the otpauth line", () => {
  it("carries the parameters every authenticator expects", () => {
    const uri = otpauthUri({
      secret: RFC_SECRET,
      issuer: "Ремука (РФ)",
      account: "ops@example.test",
    });
    const url = new URL(uri);
    expect(url.protocol).toBe("otpauth:");
    expect(url.hostname).toBe("totp");
    expect(url.pathname).toBe(
      `/${encodeURIComponent("Ремука (РФ)")}:${encodeURIComponent("ops@example.test")}`,
    );
    expect(decodeURIComponent(url.pathname)).toBe("/Ремука (РФ):ops@example.test");
    expect(url.searchParams.get("secret")).toBe(RFC_SECRET);
    expect(url.searchParams.get("issuer")).toBe("Ремука (РФ)");
    expect(url.searchParams.get("algorithm")).toBe("SHA1");
    expect(url.searchParams.get("digits")).toBe("6");
    expect(url.searchParams.get("period")).toBe("30");
  });
});

describe("recovery codes", () => {
  it("are ten symbols without easily confused characters", () => {
    const code = newRecoveryCode();
    expect(code).toMatch(/^[2-9A-HJ-NP-Z]{5}-[2-9A-HJ-NP-Z]{5}$/);
    expect(code).not.toMatch(/[01OI]/);
  });

  it("are issued distinct and one per line of the specification", () => {
    const codes = newRecoveryCodes(10);
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
  });

  it("are hashed after normalising case, spaces and the dash", () => {
    const code = newRecoveryCode();
    const plain = code.replace("-", "").toLowerCase();
    expect(normalizeRecoveryCode(plain)).toBe(code);
    expect(hashRecoveryCode(plain)?.equals(hashRecoveryCode(` ${code} `))).toBe(true);
    expect(hashRecoveryCode(code)).toHaveLength(32);
  });

  it("refuse anything that is not a code", () => {
    expect(normalizeRecoveryCode("")).toBeNull();
    expect(normalizeRecoveryCode("AAAAA-AAAA")).toBeNull();
    expect(normalizeRecoveryCode("11111-11111")).toBeNull();
    expect(hashRecoveryCode("nope")).toBeNull();
  });
});
