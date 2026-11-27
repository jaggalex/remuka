/**
 * «Хром»: the share of organisations that use each chrome control (`spec/tidy-desk.md`
 * §9, ADR-266, ADR-294).
 *
 * The share is not a sum of daily rows: one organisation that pressed a button on two
 * days is still one organisation. The aggregate therefore writes a trailing 28-day
 * snapshot for every day (`chrome.orgs28`, denominator `active.orgs28`), and the panel
 * reads the latest complete day. A control with no row is "—"; a control with a row and
 * zero organisations is a real zero.
 *
 * The rule is the owner's, once a quarter: below 5 % the element is a candidate to go
 * deeper; above 40 % a hidden element is a candidate for a permanent place. The panel
 * only names candidates — it never moves a control by itself.
 */
import { CHROME_CONTROLS } from "@remo/metrics";
import { percent } from "./week.mjs";
import { normalizeDim } from "./catalog.mjs";

/** The trailing window of the share (`spec/tidy-desk.md` §9). */
export const CHROME_WINDOW_DAYS = 28;
/** Below this share a control is a candidate to be hidden deeper. */
export const CHROME_DEEP_SHARE = 5;
/** Above this share a hidden control is a candidate for a permanent place. */
export const CHROME_SURFACE_SHARE = 40;

/** The dimension value of a control: the storage normalises every dim (`spec/pulse.md` §4.1). */
export function chromeDim(control) {
  return normalizeDim(control);
}

/**
 * The verdict for one control. Comparisons are strict, as the specification writes them:
 * exactly 5 % is not "below 5", exactly 40 % is not "above 40". A visible control is
 * never a candidate to be surfaced: it is already in the header.
 */
export function chromeVerdict(orgs, activeOrgs, where = "menu") {
  if (orgs === null || orgs === undefined || !activeOrgs) {
    return { share: null, verdict: null };
  }
  const share = percent(orgs, activeOrgs);
  if (share < CHROME_DEEP_SHARE) return { share, verdict: "deep" };
  if (where === "menu" && share > CHROME_SURFACE_SHARE) return { share, verdict: "place" };
  return { share, verdict: null };
}

/**
 * The table of the section: every control from the closed list, used or not.
 *
 * `orgsByControl` may hold `null` for a missing aggregate row, which is a hole rather
 * than a zero; the row keeps `null` and the panel prints "—". A zero from the aggregate
 * stays a zero and takes part in the "below 5 %" rule.
 */
export function chromeItems({ orgsByControl = new Map(), activeOrgs = null } = {}) {
  const items = CHROME_CONTROLS.map((control) => {
    const orgs = orgsByControl.get(control.id) ?? null;
    const { share, verdict } = chromeVerdict(orgs, activeOrgs, control.where);
    return { control: control.id, where: control.where, orgs, share, verdict };
  });
  return items.sort((a, b) => {
    const left = a.share ?? -1;
    const right = b.share ?? -1;
    if (left !== right) return right - left;
    return a.control < b.control ? -1 : a.control > b.control ? 1 : 0;
  });
}
