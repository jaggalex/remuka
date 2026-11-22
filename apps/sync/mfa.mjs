/**
 * TOTP for installation operators (ADR-260, `spec/totp.md` §2).
 *
 * One pure module for the two things that must not be re-implemented per route: the code
 * a person's authenticator app shows, and the decision whether a presented code counts.
 * Everything here is a function of its arguments — no database, no clock of its own — so
 * the RFC 6238 vectors are a unit test and the replay rule can be checked without a server.
 *
 * The parameters are the least common denominator every authenticator supports: SHA-1,
 * six digits, a thirty-second step and a ±1 step window for clock drift. The secret is 20
 * random bytes in Base32; it is sealed before it reaches the database (`apps/sync/pg/mfa.mjs`)
 * and this module never learns where it is stored.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { BRAND } from "@remo/brand";
import { productNameOverride } from "./product-name.mjs";

export const TOTP_ALGORITHM = "SHA1";
export const TOTP_DIGITS = 6;
export const TOTP_PERIOD_SECONDS = 30;
/** The current step and one neighbour each way (`spec/totp.md` §2). */
export const TOTP_WINDOW = 1;
/** How far a code may look "right" and still be refused as a clock problem. */
export const TOTP_SKEW_STEPS = 3;

/** A sign-in challenge is short-lived: the password was just proved (`spec/totp.md` §5). */
export const MFA_CHALLENGE_TTL_MS = 5 * 60 * 1000;
/** Five wrong codes end the challenge; the password has to be entered again. */
export const MFA_CHALLENGE_ATTEMPTS = 5;
/** Ten wrong codes for one account in an hour close code sign-in for the rest of it. */
export const MFA_HOURLY_FAILURES = 10;
/** Ten one-time recovery codes, shown once (`spec/totp.md` §4). */
export const MFA_RECOVERY_CODES = 10;
/** Below this many codes left the interface suggests regenerating them (§5). */
export const MFA_RECOVERY_LOW = 3;
/**
 * Shell failures: five wrong codes close the operator's money and measure commands for
 * fifteen minutes (`spec/operator-actions.md` §5). The attempts live in
 * `mfa_cli_attempts`, so the window is also the retention threshold for those rows.
 */
export const MFA_CLI_ATTEMPTS = 5;
export const MFA_CLI_LOCK_MS = 15 * 60 * 1000;

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
/** 32 symbols, so `byte & 31` is uniform: no modulo bias in a recovery code. */
const RECOVERY_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const RECOVERY_LENGTH = 10;
const RECOVERY_GROUP = 5;

/* --------------------------------------------------------------- base32 -- */

/** RFC 4648 Base32 without padding: what an authenticator app accepts as a manual key. */
export function base32Encode(bytes) {
  const data = Buffer.from(bytes);
  let buffer = 0;
  let bits = 0;
  let out = "";
  for (const byte of data) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(buffer << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text) {
  const clean = String(text ?? "")
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/=+$/, "");
  if (!clean) throw new Error("the base32 secret is empty");
  let buffer = 0;
  let bits = 0;
  const out = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index === -1) throw new Error("the base32 secret contains an invalid character");
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((buffer >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/* ------------------------------------------------------------------ code -- */

/** A new secret: 20 random bytes, Base32 on the wire and inside the QR. */
export function newTotpSecret() {
  return base32Encode(randomBytes(20));
}

/** The step a moment belongs to. One clock for the code, the tests and the database. */
export function totpStep(now = Date.now()) {
  const ms = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(ms)) throw new Error("totpStep needs a date or a timestamp");
  return Math.floor(ms / 1000 / TOTP_PERIOD_SECONDS);
}

/** The six digits for one step (RFC 6238 §4.2, dynamic truncation). */
export function totpCode(secret, step) {
  if (!Number.isSafeInteger(step) || step < 0) throw new Error("a totp step is a non-negative integer");
  const key = base32Decode(secret);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", key).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    (((digest[offset] & 0x7f) << 24) |
      (digest[offset + 1] << 16) |
      (digest[offset + 2] << 8) |
      digest[offset + 3]) >>>
    0;
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

/** Digits only; a space pasted from the app is not a different code (`spec/totp.md` §8). */
export function normalizeTotpCode(value) {
  const text = String(value ?? "").replace(/[\s\u00a0]/g, "");
  return new RegExp(`^[0-9]{${TOTP_DIGITS}}$`).test(text) ? text : null;
}

function sameCode(expected, presented) {
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(presented, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Decide whether a presented code is the one for this moment.
 *
 * `lastStep` is the step already accepted for this account: the database keeps it, so the
 * same code cannot be used twice, even inside its own thirty seconds (rule 4). A step at
 * or below the last one is a replay, not a late code — accepting it would make a shoulder
 * -surfed code worth two sign-ins.
 *
 * Returns `{ ok: true, step }` or `{ ok: false, reason }` where the reason is one of
 * `malformed`, `replayed`, `clock_skew` (the code would pass two or three steps away, so
 * the server's clock is suspect) and `mismatch`.
 */
export function matchTotp({
  secret,
  code,
  now = Date.now(),
  lastStep = null,
  window = TOTP_WINDOW,
} = {}) {
  const presented = normalizeTotpCode(code);
  if (!presented) return { ok: false, reason: "malformed" };
  const current = totpStep(now);
  const offsets = [0];
  for (let distance = 1; distance <= window; distance += 1) offsets.push(-distance, distance);
  for (const offset of offsets) {
    const step = current + offset;
    if (step < 0) continue;
    if (!sameCode(totpCode(secret, step), presented)) continue;
    if (lastStep !== null && lastStep !== undefined && step <= Number(lastStep)) {
      return { ok: false, reason: "replayed", step };
    }
    return { ok: true, step };
  }
  // A code from two or three steps away is refused, but for a reason worth a metric: the
  // connection is fine and the person's app is fine, so the server's clock is not.
  for (let distance = window + 1; distance <= TOTP_SKEW_STEPS; distance += 1) {
    for (const offset of [-distance, distance]) {
      const step = current + offset;
      if (step >= 0 && sameCode(totpCode(secret, step), presented)) {
        return { ok: false, reason: "clock_skew", step };
      }
    }
  }
  return { ok: false, reason: "mismatch" };
}

/* --------------------------------------------------------------- issuer -- */

/** The installation's name in the authenticator: two clouds must not look alike (§2). */
export const MFA_ISSUER = Object.freeze({
  // The name comes from the brand module, never from a literal (ADR-254 §4.3); the zone
  // in brackets is a deployment fact, not a second product name.
  ru: `${BRAND.name.ru} (РФ)`,
  eu: `${BRAND.name.en} (EU)`,
});

/**
 * The `issuer` an entry is filed under.
 *
 * The compliance zone is a deployment fact and wins: an operator of the Russian cloud and
 * one of the EU cloud see two different entries even in the same app. A self-host has no
 * zone, so its own `REMO_PRODUCT_NAME` names the entry; without one, the brand's English
 * spelling is the honest default.
 */
export function mfaIssuer(env = process.env) {
  const zone = String(env.REMO_COMPLIANCE_ZONE ?? "").trim().toLowerCase();
  if (zone === "ru") return MFA_ISSUER.ru;
  if (zone === "eu") return MFA_ISSUER.eu;
  return productNameOverride(env) ?? BRAND.name.en;
}

/** The `otpauth://` line the QR encodes; it is returned once, at enrolment (§4). */
export function otpauthUri({ secret, issuer, account }) {
  if (!secret) throw new Error("otpauthUri needs a secret");
  if (!issuer) throw new Error("otpauthUri needs an issuer");
  if (!account) throw new Error("otpauthUri needs an account");
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const params = new URLSearchParams({
    secret: String(secret),
    issuer: String(issuer),
    algorithm: TOTP_ALGORITHM,
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/* ------------------------------------------------------- recovery codes -- */

/**
 * One recovery code: ten symbols from an alphabet without `0`, `1`, `O` and `I`, so a code
 * read from a printout cannot be mistyped into a different valid one. Ten symbols of 32
 * are 50 bits — enough that a SHA-256 digest is a safe store (`spec/totp.md` §3).
 */
export function newRecoveryCode() {
  const bytes = randomBytes(RECOVERY_LENGTH);
  let text = "";
  for (const byte of bytes) text += RECOVERY_ALPHABET[byte & 31];
  return `${text.slice(0, RECOVERY_GROUP)}-${text.slice(RECOVERY_GROUP)}`;
}

/** Distinct codes for one account; a collision would silently shorten the list. */
export function newRecoveryCodes(count = MFA_RECOVERY_CODES) {
  if (!Number.isInteger(count) || count < 1) throw new Error("a recovery code count is positive");
  const codes = new Set();
  while (codes.size < count) codes.add(newRecoveryCode());
  return [...codes];
}

/** The code as a person may type it: lowercase, with or without the dash. */
export function normalizeRecoveryCode(value) {
  const text = String(value ?? "")
    .toUpperCase()
    .replace(/[\s\u00a0-]/g, "");
  if (text.length !== RECOVERY_LENGTH) return null;
  for (const char of text) {
    if (!RECOVERY_ALPHABET.includes(char)) return null;
  }
  return `${text.slice(0, RECOVERY_GROUP)}-${text.slice(RECOVERY_GROUP)}`;
}

/** SHA-256 of the normalised code, or `null` when the input is not a recovery code. */
export function hashRecoveryCode(value) {
  const normalized = normalizeRecoveryCode(value);
  if (!normalized) return null;
  return createHash("sha256").update(normalized).digest();
}
