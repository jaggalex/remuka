import { useEffect, useState } from "react";
import { Badge, Link, Tabs } from "@remo/ui";
import { formatMoney } from "../apiBilling";
import { formatDateTime } from "../format";
import { useI18n } from "../i18n";
import { operatorApi, type MoneyOverview } from "./operatorApi";

/**
 * «Деньги» (`spec/operator-actions.md` §4.2): four read-only tables.
 *
 * Connections carry no secret — the service never selects one — dead webhooks are shown
 * with their error and attempts, refunds name who and through which channel, and credit or
 * manual payments keep author and reason. Writing still happens in the shell or in the
 * customer card's action forms.
 */
type MoneyTab = "connections" | "dead" | "refunds" | "movements";

export function OperatorMoney() {
  const { t, lang } = useI18n();
  const [tab, setTab] = useState<MoneyTab>("connections");
  const [data, setData] = useState<MoneyOverview | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    operatorApi
      .money()
      .then((result) => {
        if (alive) setData(result);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (failed) return <p className="operator-note">{t("operator.failed")}</p>;
  if (!data) return <p className="operator-note">{t("operator.loading")}</p>;

  const money = (value: number, currency: string) => formatMoney(value, currency, lang);
  const card = (orgId: string) => (
    <Link href={`/operator?tab=customers&org=${encodeURIComponent(orgId)}`}>
      {t("operator.money.openCard")}
    </Link>
  );

  return (
    <div className="operator-section">
      <Tabs
        label={t("operator.tabs.money")}
        value={tab}
        onChange={(next) => setTab(next as MoneyTab)}
        tabs={[
          { id: "connections", label: t("operator.money.connections"), count: data.connections.length },
          { id: "dead", label: t("operator.money.dead"), count: data.deadEvents.length },
          { id: "refunds", label: t("operator.money.refunds"), count: data.refunds.length },
          { id: "movements", label: t("operator.money.movements"), count: data.movements.length },
        ]}
      />

      {tab === "connections" && (
        <>
          <p className="operator-note">{t("operator.money.readOnly")}</p>
          {data.connections.length === 0 ? (
            <p className="operator-note">{t("operator.money.empty")}</p>
          ) : (
            <table className="operator-table">
              <thead>
                <tr>
                  <th>{t("operator.money.connection.name")}</th>
                  <th>{t("operator.money.connection.provider")}</th>
                  <th>{t("operator.money.connection.mode")}</th>
                  <th>{t("operator.money.connection.status")}</th>
                  <th>{t("operator.money.connection.lastEvent")}</th>
                </tr>
              </thead>
              <tbody>
                {data.connections.map((connection) => (
                  <tr key={connection.id}>
                    <td>{connection.name}</td>
                    <td>{connection.provider}</td>
                    <td>
                      <Badge tone={connection.mode === "live" ? "success" : "warning"}>
                        {connection.mode}
                      </Badge>
                    </td>
                    <td>{connection.status}</td>
                    <td>{connection.lastEventAt ? formatDateTime(connection.lastEventAt, lang) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      {tab === "dead" && (
        <>
          <p className="operator-note">{t("operator.money.deadReadOnly")}</p>
          {data.deadEvents.length === 0 ? (
            <p className="operator-note">{t("operator.money.empty")}</p>
          ) : (
            <table className="operator-table">
              <thead>
                <tr>
                  <th>{t("operator.money.dead.provider")}</th>
                  <th>{t("operator.money.dead.type")}</th>
                  <th>{t("operator.money.dead.error")}</th>
                  <th>{t("operator.money.dead.attempts")}</th>
                  <th>{t("operator.money.dead.when")}</th>
                </tr>
              </thead>
              <tbody>
                {data.deadEvents.map((event) => (
                  <tr key={event.id}>
                    <td>{event.provider}</td>
                    <td>{event.type}</td>
                    <td>{event.error ?? "—"}</td>
                    <td>{event.attempts}</td>
                    <td>{formatDateTime(event.deadAt, lang)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      {tab === "refunds" && (
        <>
          {data.refunds.length === 0 ? (
            <p className="operator-note">{t("operator.money.empty")}</p>
          ) : (
            <table className="operator-table">
              <thead>
                <tr>
                  <th>{t("operator.money.refund.org")}</th>
                  <th>{t("operator.money.refund.author")}</th>
                  <th>{t("operator.money.refund.when")}</th>
                  <th>{t("operator.money.refund.amount")}</th>
                  <th>{t("operator.money.refund.status")}</th>
                  <th>{t("operator.money.refund.channel")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.refunds.map((refund) => (
                  <tr key={refund.id}>
                    <td>{refund.orgName || refund.orgSlug || refund.orgId}</td>
                    <td>{refund.authorEmail || "—"}</td>
                    <td>{formatDateTime(refund.createdAt, lang)}</td>
                    <td>{money(refund.amount, refund.currency)}</td>
                    <td>{refund.status}</td>
                    <td>{refund.channel ?? "—"}</td>
                    <td>{card(refund.orgId)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      {tab === "movements" && (
        <>
          {data.movements.length === 0 ? (
            <p className="operator-note">{t("operator.money.empty")}</p>
          ) : (
            <table className="operator-table">
              <thead>
                <tr>
                  <th>{t("operator.money.movement.kind")}</th>
                  <th>{t("operator.money.movement.org")}</th>
                  <th>{t("operator.money.movement.author")}</th>
                  <th>{t("operator.money.movement.reason")}</th>
                  <th>{t("operator.money.refund.amount")}</th>
                  <th>{t("operator.money.refund.when")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.movements.map((movement) => (
                  <tr key={`${movement.kind}-${movement.id}`}>
                    <td>{t(`operator.money.movement.kind.${movement.kind}`)}</td>
                    <td>{movement.orgName || movement.orgSlug || movement.orgId}</td>
                    <td>{movement.authorEmail || "—"}</td>
                    <td>{movement.reason || "—"}</td>
                    <td>{money(movement.amount, movement.currency)}</td>
                    <td>{formatDateTime(movement.createdAt, lang)}</td>
                    <td>{card(movement.orgId)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
