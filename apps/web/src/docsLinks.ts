/**
 * The guide address from `GET /config` and the one way to build a link to it (ADR-284).
 *
 * The guide belongs to the installation: the cloud has one per zone, a stand its own, and
 * a self-host may have none. The build therefore never names a host — `docs.origin` is the
 * answer, `null` means there is no guide and the interface shows plain text instead of an
 * anchor. Nothing else in the app may compose that address; `docsHref` keeps the joining
 * rule (one slash, no trailing one) in a single place.
 */

/**
 * An absolute `https` origin without a path, query, fragment or trailing `/`, or `null`.
 *
 * The service validates the variable too; this is the untrusted-JSON side of the same rule
 * (`compliance.ts` does the same for its links), so a broken answer cannot become a
 * `javascript:` link or a link to somebody else's page.
 */
export function readDocsOrigin(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const { origin } = value as { origin?: unknown };
  if (typeof origin !== "string" || !origin.trim()) return null;
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:" || !url.hostname) return null;
    if (url.username || url.password) return null;
    if (url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * A link into the guide, or `null` when the installation has no guide.
 *
 * `path` is the part after the host, with or without a leading `/`; the result never has a
 * double slash. A caller renders the link only when this answers a string, so a self-host
 * without `REMO_DOCS_ORIGIN` keeps the text but loses the dead anchor.
 */
export function docsHref(origin: string | null, path: string): string | null {
  if (!origin) return null;
  const rest = path.startsWith("/") ? path : `/${path}`;
  return `${origin.replace(/\/+$/, "")}${rest}`;
}
