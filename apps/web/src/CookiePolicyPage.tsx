/**
 * `/legal/cookies`: the policy page of §6.4, in both interface languages.
 *
 * The table is rendered from `@remo/consent` — the same registry the notice lists and the
 * gate enforces — so the page cannot describe a cookie the code does not set, or miss one
 * it does. The route is a query parameter (`/?legal=cookies`) because the app has no
 * router: `?room=` and `?org=` are already the address of state (see `App`).
 *
 * The operator's own policy address, when `REMO_COOKIE_POLICY_URL` is set, is offered as
 * the full document; otherwise this page is the document.
 */
import { Button, Link } from "@remo/ui";
import { POLICY_VERSION } from "@remo/consent";
import { hasTracking, policyRows } from "./consentClient";
import { CATEGORY_KEYS, lifetimeKey } from "./consentText";
import { useConsent } from "./ConsentProvider";
import { useCompliance, useI18n } from "./i18n";

export interface PolicyTableRow {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly lifetime: string;
  readonly purpose: string;
}

/** The one table of the page: every registry record, nothing else (§6.4). */
export function CookiePolicyTable({
  rows,
  columns,
  label,
}: {
  rows: readonly PolicyTableRow[];
  columns: { name: string; category: string; lifetime: string; purpose: string };
  label: string;
}) {
  return (
    <table className="consent-legal-table" aria-label={label}>
      <thead>
        <tr>
          <th scope="col">{columns.name}</th>
          <th scope="col">{columns.category}</th>
          <th scope="col">{columns.lifetime}</th>
          <th scope="col">{columns.purpose}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            <td>
              <code>{row.name}</code>
            </td>
            <td>{row.category}</td>
            <td>{row.lifetime}</td>
            <td>{row.purpose}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function CookiePolicyPage() {
  const { t, lang } = useI18n();
  const compliance = useCompliance();
  const { openSettings } = useConsent();

  const rows: PolicyTableRow[] = policyRows().map((entry) => {
    const key = lifetimeKey(entry.lifetime);
    return {
      id: `${entry.category}:${entry.name}`,
      category: t(CATEGORY_KEYS[entry.category]),
      name: entry.name,
      purpose: entry.purpose[lang],
      lifetime: key ? t(key) : entry.lifetime,
    };
  });

  return (
    <div className="consent-legal">
      <header className="consent-legal-topbar">
        <a className="consent-legal-home" href="/">
          {t("consent.legal.back")}
        </a>
      </header>
      <main className="consent-legal-main">
        <h1>{t("consent.legal.title")}</h1>
        <p>{t("consent.legal.intro")}</p>
        <p className="consent-legal-edition">
          {t("consent.legal.edition", { version: POLICY_VERSION })}
        </p>
        {!hasTracking() && <p className="consent-legal-note">{t("consent.legal.necessaryOnly")}</p>}

        <CookiePolicyTable
          rows={rows}
          label={t("consent.legal.title")}
          columns={{
            name: t("consent.legal.columns.name"),
            category: t("consent.legal.columns.category"),
            lifetime: t("consent.legal.columns.lifetime"),
            purpose: t("consent.legal.columns.purpose"),
          }}
        />

        <div className="consent-legal-actions">
          <Button variant="secondary" onClick={openSettings}>
            {t("consent.legal.manage")}
          </Button>
          {compliance.policyUrl && (
            <Link href={compliance.policyUrl} target="_blank" rel="noreferrer">
              {t("consent.legal.full")}
            </Link>
          )}
        </div>
      </main>
    </div>
  );
}
