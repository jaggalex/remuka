import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Input, Link } from "@remo/ui";
import { formatMoney } from "../apiBilling";
import { formatDate, formatDateTime } from "../format";
import { useI18n } from "../i18n";
import {
  operatorApi,
  type CustomerCard,
  type CustomerMatch,
  type CustomerOrg,
} from "./operatorApi";
import {
  CreditDialog,
  GrantDialog,
  MarkPaidDialog,
  MeasureDialog,
  RefundDialog,
  type NeedCode,
} from "./OperatorActionDialog";

/**
 * «Клиенты»: the support card (`spec/operator.md` §5, stage 2, read-only).
 *
 * Search by an address, an organisation or an invoice number; then plan, subscription,
 * invoices, payments, counts, accepted documents and measures. Room names and content are
 * not in the response, so the screen cannot show them even by accident.
 */
export function OperatorCustomers({ onNeedCode }: { onNeedCode: NeedCode }) {
  const { t, lang } = useI18n();
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<CustomerMatch[]>([]);
  const [selected, setSelected] = useState<{ kind: "user" | "org"; id: string } | null>(null);
  const [card, setCard] = useState<CustomerCard | null>(null);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    const text = query.trim();
    if (text.length < 2) {
      setMatches([]);
      setSearched(false);
      return;
    }
    let alive = true;
    const timer = window.setTimeout(() => {
      operatorApi
        .customers(text)
        .then((result) => {
          if (alive) {
            setMatches(result.matches);
            setSearched(true);
          }
        })
        .catch(() => {
          if (alive) setError(true);
        });
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [query]);

  const open = useCallback(async (kind: "user" | "org", id: string) => {
    setSelected({ kind, id });
    setError(false);
    try {
      setCard(await operatorApi.customer(kind, id));
    } catch {
      setCard(null);
      setError(true);
    }
  }, []);

  // A refund or a credit in «Деньги» links to the customer card by organisation id.
  useEffect(() => {
    const org = new URLSearchParams(window.location.search).get("org");
    if (org) void open("org", org);
  }, [open]);

  return (
    <div className="operator-customers">
      <div className="operator-search">
        <Input
          type="search"
          label={t("operator.customers.search")}
          hint={t("operator.customers.searchHint")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          autoFocus
        />
        <ul className="operator-matches">
          {matches.map((match) => (
            <li key={`${match.kind}-${match.id}`}>
              <Button
                variant="ghost"
                className={
                  selected?.id === match.id ? "operator-match is-selected" : "operator-match"
                }
                onClick={() => void open(match.kind === "invoice" ? "org" : match.kind, match.id)}
              >
                <span>{t(`operator.customers.kind.${match.kind}`)}</span>
                <strong>{match.label}</strong>
                {match.detail && <small>{match.detail}</small>}
              </Button>
            </li>
          ))}
        </ul>
        {searched && matches.length === 0 && (
          <p className="operator-note">{t("operator.customers.empty")}</p>
        )}
      </div>

      <div className="operator-card">
        {!selected && <p className="operator-note">{t("operator.customers.pick")}</p>}
        {error && <p className="operator-note">{t("operator.failed")}</p>}
        {card && (
          <>
            {card.user && (
              <section className="operator-section">
                <h2>{t("operator.customers.account")}</h2>
                <dl className="operator-dl">
                  <Row label={t("operator.customers.account")} value={card.user.email} />
                  <Row
                    label={t("operator.customers.plan")}
                    value={t(
                      card.user.emailVerifiedAt
                        ? "operator.customers.addressConfirmed"
                        : "operator.customers.addressPending",
                    )}
                  />
                  <Row label={t("operator.journal.time")} value={formatDate(card.user.createdAt, lang)} />
                </dl>
              </section>
            )}
            {card.orgs.map((org) => (
              <OrgCard
                key={org.id}
                org={org}
                supportUrl={card.supportUrl}
                onNeedCode={onNeedCode}
                onRefresh={() => selected && void open(selected.kind, selected.id)}
              />
            ))}
            <p className="operator-note">{t("operator.customers.noRoomContent")}</p>
          </>
        )}
      </div>
    </div>
  );
}

type OrgDialog =
  | { kind: "refund"; payment: CustomerOrg["payments"][number] }
  | { kind: "markPaid"; invoice: CustomerOrg["invoices"][number] }
  | { kind: "credit" }
  | { kind: "grant" }
  | { kind: "suspend" };

function OrgCard({
  org,
  supportUrl,
  onNeedCode,
  onRefresh,
}: {
  org: CustomerOrg;
  supportUrl: string | null;
  onNeedCode: NeedCode;
  onRefresh: () => void;
}) {
  const { t, lang } = useI18n();
  const [dialog, setDialog] = useState<OrgDialog | null>(null);
  const amount = (value: number, currency: string) => formatMoney(value, currency, lang);
  return (
    <section className="operator-section">
      <h2>
        {org.name || org.slug} <Badge tone={org.suspendedAt ? "danger" : "neutral"}>{org.kind}</Badge>
      </h2>
      {org.suspendedAt && (
        <p className="operator-note">{t("operator.customers.suspended")}</p>
      )}
      <div className="operator-actions">
        <Button size="compact" variant="secondary" onClick={() => setDialog({ kind: "credit" })}>
          {t("operator.customers.creditAction")}
        </Button>
        <Button size="compact" variant="secondary" onClick={() => setDialog({ kind: "grant" })}>
          {t("operator.customers.grant")}
        </Button>
        <Button
          size="compact"
          variant="ghost-danger"
          disabled={Boolean(org.suspendedAt)}
          onClick={() => setDialog({ kind: "suspend" })}
        >
          {t("operator.customers.suspend")}
        </Button>
      </div>
      <dl className="operator-dl">
        <Row label={t("operator.customers.members")} value={String(org.counts.members)} />
        <Row label={t("operator.customers.guests")} value={String(org.counts.guests)} />
        <Row label={t("operator.customers.rooms")} value={String(org.counts.rooms)} />
        <Row
          label={t("operator.customers.plan")}
          value={
            org.subscription
              ? t("operator.customers.planValue", {
                  plan: org.subscription.plan,
                  status: org.subscription.status,
                  amount: amount(org.subscription.amount, org.subscription.currency),
                  interval: org.subscription.interval,
                })
              : t("operator.customers.none")
          }
        />
        {org.subscription && (
          <Row
            label=""
            value={t("operator.customers.period", {
              date: formatDate(org.subscription.current_period_end, lang),
            })}
          />
        )}
        <Row
          label={t("operator.customers.billing")}
          value={
            org.billing
              ? `${org.billing.email}${org.billing.currency ? ` · ${org.billing.currency}` : ""}`
              : t("operator.customers.none")
          }
        />
        <Row
          label={t("operator.customers.credit")}
          value={
            org.credit.length === 0
              ? t("operator.customers.none")
              : org.credit.map((row) => amount(row.balance, row.currency)).join(", ")
          }
        />
        {org.admins?.length ? (
          <Row
            label={t("operator.customers.admins")}
            value={org.admins.map((admin) => admin.email).join(", ")}
          />
        ) : null}
      </dl>

      <h3>{t("operator.customers.invoices")}</h3>
      {org.invoices.length === 0 ? (
        <p className="operator-note">{t("operator.customers.none")}</p>
      ) : (
        <ul className="operator-list">
          {org.invoices.map((invoice) => (
            <li key={invoice.number}>
              <span>{invoice.number}</span>
              <Badge tone={invoice.status === "paid" ? "success" : "warning"}>
                {invoice.status}
              </Badge>
              <span>{amount(invoice.total, invoice.currency)}</span>
              <small>{formatDate(invoice.created_at, lang)}</small>
              {invoice.status === "paid" || invoice.status === "void" ? (
                <Button
                  size="compact"
                  variant="ghost"
                  disabled
                  title={t(
                    invoice.status === "paid"
                      ? "operator.customers.markPaidAlready"
                      : "operator.customers.markPaidVoid",
                  )}
                >
                  {t("operator.customers.markPaid")}
                </Button>
              ) : (
                <Button
                  size="compact"
                  variant="ghost"
                  onClick={() => setDialog({ kind: "markPaid", invoice })}
                >
                  {t("operator.customers.markPaid")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <h3>{t("operator.customers.payments")}</h3>
      {org.payments.length === 0 ? (
        <p className="operator-note">{t("operator.customers.none")}</p>
      ) : (
        <ul className="operator-list">
          {org.payments.map((payment) => {
            const refundable =
              ["succeeded", "partially_refunded"].includes(payment.status) &&
              payment.refunded < payment.amount;
            const reason =
              payment.refunded >= payment.amount
                ? t("operator.customers.refundedAll")
                : t("operator.customers.refundNotPossible");
            return (
              <li key={payment.id}>
                <small>{formatDateTime(payment.created_at, lang)}</small>
                <span>{payment.invoice_number}</span>
                <Badge tone={payment.status === "succeeded" ? "success" : "neutral"}>
                  {payment.status}
                </Badge>
                <span>{amount(payment.amount, payment.currency)}</span>
                <small>
                  {t("operator.customers.refunded")}:{" "}
                  {amount(payment.refunded ?? 0, payment.currency)}
                </small>
                <Button
                  size="compact"
                  variant="ghost"
                  disabled={!refundable}
                  title={refundable ? undefined : reason}
                  onClick={() => setDialog({ kind: "refund", payment })}
                >
                  {t("operator.customers.refund")}
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      <h3>{t("operator.customers.documents")}</h3>
      {org.acceptances.length === 0 ? (
        <p className="operator-note">{t("operator.customers.none")}</p>
      ) : (
        <ul className="operator-list">
          {org.acceptances.map((acceptance, index) => (
            <li key={`${acceptance.doc}-${acceptance.version}-${index}`}>
              <span>
                {acceptance.zone}/{acceptance.doc} v{acceptance.version}
              </span>
              <small>{acceptance.user_email ?? acceptance.event}</small>
              <small>{formatDate(acceptance.accepted_at, lang)}</small>
            </li>
          ))}
        </ul>
      )}

      <h3>{t("operator.customers.measures")}</h3>
      {org.actions.length === 0 ? (
        <p className="operator-note">{t("operator.customers.none")}</p>
      ) : (
        <ul className="operator-list">
          {org.actions.map((action) => (
            <li key={action.id}>
              <span>{action.kind}</span>
              <Badge tone={action.revertedAt ? "neutral" : "danger"}>
                {t(
                  action.revertedAt
                    ? "operator.customers.reverted"
                    : "operator.customers.open",
                )}
              </Badge>
              <small>{action.reasonPublic}</small>
            </li>
          ))}
        </ul>
      )}

      {supportUrl && (
        <p>
          <Link href={supportUrl} target="_blank" rel="noreferrer">
            {t("operator.customers.chatwoot")}
          </Link>
        </p>
      )}

      {dialog?.kind === "refund" && (
        <RefundDialog
          org={org}
          payment={dialog.payment}
          onNeedCode={onNeedCode}
          onDone={() => {
            setDialog(null);
            onRefresh();
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "markPaid" && (
        <MarkPaidDialog
          org={org}
          invoice={dialog.invoice}
          onNeedCode={onNeedCode}
          onDone={() => {
            setDialog(null);
            onRefresh();
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "credit" && (
        <CreditDialog
          org={org}
          onNeedCode={onNeedCode}
          onDone={() => {
            setDialog(null);
            onRefresh();
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "grant" && (
        <GrantDialog
          org={org}
          onNeedCode={onNeedCode}
          onDone={() => {
            setDialog(null);
            onRefresh();
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "suspend" && (
        <MeasureDialog
          org={org}
          onNeedCode={onNeedCode}
          onDone={() => {
            setDialog(null);
            onRefresh();
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}
