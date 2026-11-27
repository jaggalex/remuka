/**
 * The guide address inside the in-app help (ADR-284).
 *
 * A help page is built once, at build time, but the guide belongs to the installation:
 * the cloud has one per zone, a stand its own, a self-host may have none. The Markdown
 * therefore names the guide with the token `{{docs}}` instead of a host, the build keeps
 * the token, and this module puts the answer from `/config` in its place.
 *
 * Without a guide the sentence keeps its words and loses only the anchor: a self-host that
 * publishes no documentation shows no dead link.
 */

/** The token `content/help` uses where the guide's host belongs. */
export const DOCS_TOKEN = "{{docs}}";

/** An anchor the build rendered from a token; the label may itself contain markup. */
const TOKEN_LINK = /<a\b[^>]*href="\{\{docs\}\}[^"]*"[^>]*>([\s\S]*?)<\/a>/g;

/**
 * The rendered help HTML with the guide's origin substituted, or unwrapped when there is
 * none. Nothing else is substituted: the token is the only placeholder the help has.
 */
export function withDocsOrigin(html: string, origin: string | null): string {
  if (origin) return html.split(DOCS_TOKEN).join(origin);
  return html.replace(TOKEN_LINK, "$1").split(DOCS_TOKEN).join("");
}
