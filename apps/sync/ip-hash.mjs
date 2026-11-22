/**
 * The address of a request as the journal may keep it (ADR-255 §4, ADR-256 §4).
 *
 * An address is personal data; a keyed digest is the proof that two rows came from the
 * same place without storing the place. Without `REMO_KEK` there is no key, and a plain
 * SHA-256 of an IPv4 number is a rainbow-table lookup rather than a secret, so the field
 * stays `null` instead of becoming something weaker.
 *
 * `User-Agent` is a debugging aid, truncated, never part of a decision. Both helpers live
 * here so the consent journal and the legal-acceptance journal cannot drift into two
 * definitions of "the address" or two lengths of the same header.
 */
import { createHmac } from "node:crypto";
import { clientIp } from "./client-ip.mjs";

/** A stored User-Agent is capped: the header is client-controlled and may be huge. */
export const USER_AGENT_LIMIT = 512;

/**
 * HMAC-SHA-256 of the client address under the installation's KEK, or null.
 *
 * @param {import("node:http").IncomingMessage} request
 * @param {string | undefined} key
 * @returns {string | null}
 */
export function hashedClientIp(request, key = process.env.REMO_KEK) {
  const address = clientIp(request);
  if (!key || !address || address === "unknown") return null;
  return createHmac("sha256", key).update(address).digest("hex");
}

/** The trimmed `User-Agent` header, or null when the client sent none. */
export function requestUserAgent(request) {
  const raw = request?.headers?.["user-agent"];
  const value = String(raw ?? "").trim();
  return value ? value.slice(0, USER_AGENT_LIMIT) : null;
}
