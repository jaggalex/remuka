import { useEffect, useState, type ComponentProps } from "react";
import { Link } from "@remo/ui";
import { api, type SessionUser } from "./api";
import { useI18n } from "./i18n";
import { OrganisationDialog } from "./OrganisationDialog";
import { organisationHref, type OrganisationTab } from "./organisationRoute";

/** Existing board, home and payment-return actions all enter the same routed page. */
export function OrganisationEntry({ open, initialOrgId = null, initialTab = "people" }: ComponentProps<typeof OrganisationDialog>) {
  useEffect(() => {
    if (open) location.assign(organisationHref(initialTab, initialOrgId));
  }, [open, initialOrgId, initialTab]);
  return null;
}

export function OrganisationPage({ tab }: { tab: OrganisationTab }) {
  const { t } = useI18n();
  const [user, setUser] = useState<SessionUser | null>();
  useEffect(() => {
    let live = true;
    void api.me().then(result => { if (live) setUser(result.user); }).catch(() => { if (live) setUser(null); });
    return () => { live = false; };
  }, []);
  if (!user) return <main className="org-page"><h1>{t("org.title")}</h1>
    {user === undefined ? <p role="status">{t("sessions.loading")}</p> : <Link href="/?signin=1">{t("auth.login")}</Link>}
  </main>;
  return <OrganisationDialog open me={user} initialOrgId={new URLSearchParams(location.search).get("org")}
    initialTab={tab} onClose={() => location.assign("/")} onSignedOut={() => location.assign("/")} />;
}
