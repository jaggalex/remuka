/**
 * The address of the product guide this installation links to (ADR-284).
 *
 * The interface and the in-app help link to pages of the guide, and that guide belongs to
 * the installation, not to the build: the cloud has one per zone, a stand has its own, and a
 * self-host may have none at all. The build therefore carries no host — `REMO_DOCS_ORIGIN`
 * is the one source, `GET /config` publishes it, and the browser builds every link from
 * that answer.
 *
 * An explicit value wins over the zone: the zone only says which guide the *cloud* would
 * use, while an operator who sets the variable is describing their own installation.
 *
 * A malformed address stops the start. A typo here removes every guide link from the
 * interface, and a null origin is also the legitimate self-host default, so a silent null
 * would make a broken configuration look exactly like a deliberate one (`compliance.mjs`
 * takes the same position on a mistyped zone).
 */
import { BRAND } from "@remo/brand";
import { resolveConsentZone } from "@remo/consent";

/**
 * An absolute `https` origin without a path, query, fragment or trailing `/`, or `null`.
 *
 * The value is concatenated with a guide path, so only the origin is accepted: a path
 * would silently become `https://host/guide/guide/...`, and a query has no place in a host.
 * `https://docs.example.com/` is the same origin as without the slash and is normalised.
 */
export function docsOriginValue(raw) {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    if (!url.hostname) return null;
    if (url.username || url.password) return null;
    if (url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch {
    // A malformed address never becomes a link in the interface.
    return null;
  }
}

/**
 * The guide origin of this installation: the operator's value, else the zone's guide, else
 * `null` — a self-host without a configured guide shows no links rather than somebody
 * else's guide.
 */
export function resolveDocsOrigin(env = globalThis.process?.env ?? {}) {
  const configured = String(env?.REMO_DOCS_ORIGIN ?? "").trim();
  if (configured) {
    const origin = docsOriginValue(configured);
    if (origin) return origin;
    throw new Error(
      "[sync] REMO_DOCS_ORIGIN must be an absolute https origin without a path, query or " +
        "trailing / (for example https://docs.example.com); leave it unset to use the zone " +
        "default (ADR-284)",
    );
  }
  const zone = resolveConsentZone(env);
  if (zone === "eu") return `https://${BRAND.domains.docs}`;
  if (zone === "ru") return `https://${BRAND.domains.docsRu}`;
  // `none` is a self-host: it has no guide of ours, and pointing at the cloud's would send
  // its people to another installation's documentation.
  return null;
}
