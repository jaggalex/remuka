const tabs = ["people", "teams", "audit", "billing", "agents", "storage"] as const;
export type OrganisationTab = typeof tabs[number];
export function organisationTab(path: string): OrganisationTab | null {
  return tabs.find(tab => path.replace(/\/$/, "") === "/org/" + tab) ?? null;
}
export function organisationHref(tab: OrganisationTab, org: string | null) {
  const params = new URLSearchParams();
  if (org) params.set("org", org);
  const lang = new URLSearchParams(location.search).get("lang");
  if (lang) params.set("lang", lang);
  return "/org/" + tab + (params.size ? "?" + params.toString() : "");
}

/** Preserve the paying organisation and locale when the provider sends its visitor back. */
export function billingReturnUrl(orgId: string) {
  const url = new URL(organisationHref("billing", orgId), location.origin);
  url.searchParams.set("billing", "return");
  return url.href;
}
