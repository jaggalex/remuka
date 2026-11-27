import { useEffect, useRef, useState } from "react";
import { Badge, Button, Checkbox, ChoiceCard, Icon, Link } from "@remo/ui";
import { billingApi, formatMoney, type BillingSubscription, type PlanChangeQuote, type PlanPaymentStatus, type ScheduledPlanChange } from "./apiBilling";
import { formatDate } from "./format";
import { useI18n, type TranslationKey } from "./i18n";

export const billingPlanLabel = (plan: string): TranslationKey =>
  plan === "free" || plan === "pro" || plan === "team" || plan === "business" ? `billing.plan.${plan}` : "billing.plan.free";

function ChangeComparison({ before, after }: {
  before: { name: string; detail: string }; after: { name: string; detail: string };
}) {
  const { t } = useI18n();
  return (
    <div className="billing-change-comparison">
      <div><span>{t("billing.change.before")}</span><strong>{before.name}</strong><span>{before.detail}</span></div>
      <span className="billing-change-arrow" aria-hidden="true"><Icon name="layer-down" size={16} /></span>
      <div><span>{t("billing.change.after")}</span><strong>{after.name}</strong><span>{after.detail}</span></div>
    </div>
  );
}

const periodLabel = (interval: "month" | "year") => `billing.period.${interval}` as const;

type Props = {
  quote: PlanChangeQuote;
  method: string;
  methods: { value: string; title: string }[];
  onMethod: (value: string) => void;
  autopay: boolean;
  onAutopay: (value: boolean) => void;
  termsHref: string | null;
  busy: boolean;
  expired: boolean;
  onRefresh: () => void;
  onConfirm: () => void;
  onBack: () => void;
  use: { seats: number; rooms: number; bytes: number };
};

export function BillingChangeQuote(props: Props) {
  const { quote, methods, method, use } = props;
  const { t, lang } = useI18n();
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => { title.current?.focus(); }, []);
  const upgrade = quote.type === "upgrade";
  const from = t(billingPlanLabel(quote.fromPlan));
  const to = t(billingPlanLabel(quote.plan));
  const date = formatDate(quote.effectiveAt, lang);
  const oldEnd = formatDate(quote.fromPeriodEnd, lang);
  const money = (amount: number) => formatMoney(amount, quote.currency, lang);
  const price = (amount: number, interval: "month" | "year") =>
    t("billing.change.rate", { amount: money(amount), interval: t(periodLabel(interval)) });
  const next = quote.nextPeriodEnd ? formatDate(quote.nextPeriodEnd, lang) : date;
  const expires = new Intl.DateTimeFormat(lang, { hour: "numeric", minute: "2-digit" }).format(new Date(quote.expiresAt));
  const limit = (value: number | null) => value ?? t("billing.change.unlimited");
  const roomsAffected = quote.limits.rooms === null ? 0 : Math.max(0, use.rooms - quote.limits.rooms);
  const size = (value: number | null) => value === null
    ? t("billing.change.unlimited")
    : t("billing.change.size", { n: new Intl.NumberFormat(lang, { maximumFractionDigits: 1 }).format(value / 1073741824) });

  const limitChange = (earlier: number | null, later: number | null, present = limit) =>
    earlier === later ? present(later) : `${present(earlier)} → ${present(later)}`;

  return (
    <div className="billing-change-layout">
      <section className="billing-change-card">
        <h3 ref={title} tabIndex={-1}>{t("billing.change.title", { plan: to })}</h3>
        <ChangeComparison
          before={{ name: from, detail: `${t("billing.change.until", { date: oldEnd })} · ${price(quote.fromAmount, quote.fromInterval)}` }}
          after={{ name: to, detail: quote.plan === "free" ? t("billing.change.noCharge") : price(quote.amount, quote.interval) }} />
        <p>{upgrade
          ? t("billing.change.starts", { plan: to })
          : t(quote.plan === "free" ? "billing.change.freeWhen" : "billing.change.downWhen", { to, from, date })}</p>
        <dl className="billing-change-facts">
          <div><dt>{t("billing.change.seats")}</dt><dd>{limitChange(quote.previousLimits.seats, quote.limits.seats)}{!upgrade && <small>{t("billing.change.used", { n: use.seats })}</small>}</dd></div>
          <div><dt>{t("billing.change.rooms")}</dt><dd>{limitChange(quote.previousLimits.rooms, quote.limits.rooms)}{!upgrade && <small>{t("billing.change.used", { n: use.rooms })}</small>}</dd></div>
          <div><dt>{t("billing.change.storage")}</dt><dd>{limitChange(quote.previousLimits.storageBytes, quote.limits.storageBytes, size)}{!upgrade && <small>{t("billing.change.used", { n: size(use.bytes) })}</small>}</dd></div>
        </dl>
        {!upgrade && roomsAffected > 0 && <p className="billing-warning">{t("billing.change.roomsAffected", { n: roomsAffected })}</p>}
        {upgrade && quote.total > 0 && (
          <div className="billing-change-methods">
            <ChoiceCard label={t("billing.method")} columns={1} value={method} onChange={props.onMethod} options={methods} />
            {quote.autopayMethods.includes(method) && (
              <Checkbox checked={props.autopay} onChange={event => props.onAutopay(event.target.checked)}
                label={t("billing.change.autopay")} />
            )}
          </div>
        )}
      </section>
      <section className="billing-change-card">
        <h3>{t("billing.change.calculation")}</h3>
        <dl className="billing-change-lines">
          {upgrade && <>
            <div><dt>{t("billing.change.newPeriod", { plan: to, date, next })}</dt><dd>{money(quote.amount)}</dd></div>
            <div><dt>{t("billing.change.credit", { plan: from })}</dt><dd>−{money(quote.credit)}</dd></div>
          </>}
          <div className="billing-change-total"><dt>{t("billing.change.dueNow")}</dt><dd>{money(quote.total)}</dd></div>
        </dl>
        {quote.plan !== "free" && (!upgrade || props.autopay && quote.autopayMethods.includes(method)) && (
          <p>{t(upgrade ? "billing.change.next" : "billing.change.nextInvoice", { date: next, amount: money(quote.amount) })}</p>
        )}
        {upgrade && <p className="muted">
          {t("billing.change.valid", { time: expires })} {t("billing.change.terms")} {props.termsHref && <Link href={props.termsHref} target="_blank" rel="noreferrer">{t("billing.termsLink")}</Link>}
        </p>}
        {props.expired && <p role="alert">{t("billing.change.expired")}</p>}
        {props.expired ? (
          <Button variant="primary" onClick={props.onRefresh}>{t("billing.change.refresh")}</Button>
        ) : (
          <Button variant="primary" disabled={props.busy || upgrade && quote.total > 0 && !method} onClick={props.onConfirm}>
            {upgrade
              ? quote.total > 0 ? t("billing.change.pay", { amount: money(quote.total) }) : t("billing.change.confirm")
              : t("billing.change.schedule", { plan: to })}
          </Button>
        )}
        <div className="billing-actions"><Button variant="ghost" onClick={props.onBack} disabled={props.busy}>{t("billing.back")}</Button></div>
      </section>
    </div>
  );
}

export function BillingScheduledChange({ change, current, canCancel, onCancel, children }: {
  change: ScheduledPlanChange; current: BillingSubscription; canCancel: boolean; onCancel: () => void; children?: React.ReactNode;
}) {
  const { t, lang } = useI18n();
  const date = formatDate(change.at, lang);
  const to = t(billingPlanLabel(change.plan));
  const from = t(billingPlanLabel(current.plan));
  return (
    <section className="billing-change-card billing-scheduled-change">
      <Badge tone="neutral">{t("billing.change.scheduled")}</Badge>
      <h3>{t("billing.change.scheduledHeading", { date, plan: to })}</h3>
      <p>{t(change.plan === "free" ? "billing.change.freeWhen" : "billing.change.downWhen", { from, to, date })}</p>
      {change.plan !== "free" && <p>{t("billing.change.nextInvoice", {
        date, amount: formatMoney(change.amount, change.currency, lang),
      })}</p>}
      <div className="billing-scheduled-comparison">
        <ChangeComparison
          before={{ name: from, detail: t("billing.change.until", { date }) }}
          after={{ name: to, detail: change.plan === "free" ? t("billing.change.noCharge")
            : t("billing.change.rate", { amount: formatMoney(change.amount, change.currency, lang), interval: t(periodLabel(change.interval)) }) }} />
      </div>
      <div className="billing-actions">
        {canCancel && <Button variant="secondary" onClick={onCancel}>{t("billing.change.cancel")}</Button>}
        {children}
      </div>
    </section>
  );
}

export function BillingChangePayment({ orgId, paymentId, onSettled, onRetry }: {
  orgId: string; paymentId: string; onSettled: () => void; onRetry: () => void;
}) {
  const { t } = useI18n();
  const [status, setStatus] = useState<PlanPaymentStatus | null>(null);
  const [slow, setSlow] = useState(false);
  const [check, setCheck] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const known = status?.plan;
  useEffect(() => { if (known) heading.current?.focus(); }, [known]);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let tries = 0;
    if (check > 0) setSlow(false);
    async function read() {
      try {
        const result = await billingApi.checkoutStatus(orgId, paymentId);
        if (!active) return;
        if (!result.plan) return;
        setStatus(result);
        if (result.applied) { onSettled(); return; }
        if (result.status !== "pending" && result.status !== "succeeded") return;
      } catch {
        if (!active) return;
      }
      tries += 1;
      if (tries < 30) timer = setTimeout(() => void read(), 2000);
      else setSlow(true);
    }
    void read();
    return () => { active = false; clearTimeout(timer); };
  }, [orgId, paymentId, check, onSettled]);
  if (!status?.plan) return null;
  const failed = status.status !== "pending" && status.status !== "succeeded" && !status.applied;
  const plan = t(billingPlanLabel(status.plan));
  const key = status.applied ? "billing.change.done"
    : failed ? "billing.change.failed"
    : status.status === "succeeded" ? "billing.change.applying"
    : slow ? "billing.change.slow" : "billing.change.checking";
  return (
    <section className="billing-change-card" role={failed ? "alert" : "status"}>
      <h3 tabIndex={-1} ref={heading}>{t(key, { plan })}</h3>
      {status.invoiceNumber && <p>{t("billing.change.invoice", { number: status.invoiceNumber })}</p>}
      {failed && <Button onClick={onRetry}>{t("billing.change.retry")}</Button>}
      {!failed && !status.applied && <Button onClick={() => setCheck(value => value + 1)}>{t("billing.change.check")}</Button>}
    </section>
  );
}
