import { CHROME_CONTROL_IDS } from "@remo/metrics";
import { currentOrgSlug } from "./accessSnapshot";
import { call } from "./apiCall";

/**
 * One thin helper for `chrome.used` (`spec/tidy-desk.md` §9, ADR-266, ADR-294).
 *
 * A chrome command ran: tell the service which control, in which organisation. The
 * server keeps the first press of a control per organisation per UTC day; the client
 * does not try to deduplicate because a second tab would defeat it and the storage has
 * the rule. The call is best-effort like every product metric: a missing session, an
 * offline tab or a metrics outage changes nothing on screen.
 *
 * The registry wraps its commands with this helper, so a new surface that dispatches a
 * registry command is measured without a second call site.
 */
const known = new Set<string>(CHROME_CONTROL_IDS);

export function recordChromeUse(control: string): void {
  if (typeof window === "undefined" || !known.has(control)) return;
  const slug = currentOrgSlug();
  if (!slug) return;
  void call<{ ok: boolean }>(`/chrome/used?org=${encodeURIComponent(slug)}`, {
    method: "POST",
    body: { control },
  }).catch(() => undefined);
}
