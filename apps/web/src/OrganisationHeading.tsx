import { Button, Link } from "@remo/ui";
import { useI18n } from "./i18n";
import { organisationHref } from "./organisationRoute";
import type { OrgBilling } from "./apiBilling";

export function OrganisationHeading({ name, slug, description, billing, billingView, onBilling }: {
  name: string; slug?: string; description: string; billing: OrgBilling | null; billingView: boolean; onBilling: () => void;
}) {
  const { t } = useI18n();
  const max = billing?.limits.seats;
  return <header className="org-page-heading">
    <div>
      <Link href={billingView ? organisationHref("people", slug ?? null) : slug ? "/rooms?org=" + encodeURIComponent(slug) : "/"}>
        {billingView ? name : t("board.allBoards")}
      </Link>
      <h1>{billingView ? t("billing.tab") : name}</h1>
      {!billingView && <p>{description}</p>}
    </div>
    {billing && !billingView && <div className="org-seat-summary"><b>{t(max == null ? "billing.usage.seatsUnlimited" : "billing.usage.seats",
      { used: billing.usage.seats, max: max ?? 0 })}</b>
      <Button size="compact" variant="ghost" className="org-plan-link" onClick={onBilling}>{t(`billing.plan.${billing.plan}`)}</Button>
      {max != null && max > 0 && <progress aria-label={t("billing.usage")} value={billing.usage.seats} max={max} />}
    </div>}
  </header>;
}
