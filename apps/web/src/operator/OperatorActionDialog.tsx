import { useState, type ReactNode } from "react";
import { Button, Dialog, Input, Select, Textarea } from "@remo/ui";
import { ApiError } from "../apiCall";
import { formatMoney } from "../apiBilling";
import { useI18n, type TranslationKey } from "../i18n";
import {
  operatorApi,
  type CustomerOrg,
  type OperatorMeasure,
} from "./operatorApi";

/** A 403 MFA_REQUIRED answer: the console raises its code dialog and repeats the action. */
export type NeedCode = (challenge: string, retry: () => void) => void;

interface SubmitProps {
  onNeedCode: NeedCode;
  onDone: () => void;
}

const PLANS = ["pro", "team", "business"] as const;

function requestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

/** Measure kinds are a closed list; a lookup keeps `t()` typed. */
const MEASURE_LABEL: Record<string, TranslationKey> = {
  link_disable: "operator.measures.kind.link_disable",
  board_hide: "operator.measures.kind.board_hide",
  org_suspend: "operator.measures.kind.org_suspend",
};

export function measureKindKey(kind: string): TranslationKey {
  return MEASURE_LABEL[kind] ?? "operator.measures.noTarget";
}

function minorUnits(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed) || Number(trimmed) <= 0) return null;
  return Number(trimmed);
}

/** The one frame for every action: confirmation in words, a required reason, one button. */
function ActionDialog({
  title,
  description,
  children,
  submitLabel,
  danger = false,
  reason,
  onReasonChange,
  notice,
  error,
  busy,
  disabled = false,
  canSubmit = true,
  onSubmit,
  onClose,
}: {
  title: string;
  description: string;
  children?: ReactNode;
  submitLabel: TranslationKey;
  danger?: boolean;
  reason: string;
  onReasonChange: (value: string) => void;
  notice?: string | null;
  error?: string | null;
  busy: boolean;
  disabled?: boolean;
  canSubmit?: boolean;
  onSubmit: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const ready = reason.trim().length >= 10 && canSubmit && !disabled;
  return (
    <Dialog
      title={title}
      description={description}
      onClose={busy ? undefined : onClose}
      dismissable={!busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t("operator.action.cancel")}
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            onClick={onSubmit}
            disabled={!ready}
            loading={busy}
          >
            {busy ? t("operator.action.working") : t(submitLabel)}
          </Button>
        </>
      }
    >
      {children}
      <Textarea
        label={t("operator.action.reason")}
        hint={t("operator.action.reasonHint")}
        value={reason}
        onChange={(event) => onReasonChange(event.target.value)}
      />
      {notice && <p className="operator-notice">{notice}</p>}
      {error && <p className="auth-error">{error}</p>}
    </Dialog>
  );
}

function useSubmission({ onNeedCode, onDone }: SubmitProps) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const run = async (submit: () => Promise<boolean | void>) => {
    setBusy(true);
    setError(null);
    try {
      // `false` means the form stays open with its own notice (a changed refund state).
      const outcome = await submit();
      if (outcome !== false) onDone();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 403 && caught.code === "MFA_REQUIRED") {
        setNotice(t("operator.action.mfa"));
        onNeedCode(String(caught.details.challenge ?? ""), () => void run(submit));
        return;
      }
      if (caught instanceof ApiError && ["REQUEST_CONFLICT", "REQUEST_IN_PROGRESS"].includes(caught.code)) {
        setError(
          t(
            caught.code === "REQUEST_CONFLICT"
              ? "operator.action.requestConflict"
              : "operator.action.inProgress",
          ),
        );
        return;
      }
      setError(caught instanceof Error ? caught.message : t("operator.action.failed"));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, notice, setNotice, setError, run };
}

/* ------------------------------------------------------------------- refund -- */

export function RefundDialog({
  org,
  payment,
  onNeedCode,
  onDone,
  onClose,
}: SubmitProps & {
  org: CustomerOrg;
  payment: CustomerOrg["payments"][number];
  onClose: () => void;
}) {
  const { t, lang } = useI18n();
  const [id] = useState(requestId);
  const [reason, setReason] = useState("");
  const [amountText, setAmountText] = useState("");
  const [expectRefunded, setExpectRefunded] = useState(payment.refunded);
  const { busy, error, notice, setNotice, setError, run } = useSubmission({ onNeedCode, onDone });

  const remaining = payment.amount - expectRefunded;
  const typed = amountText.trim() === "" ? null : minorUnits(amountText);
  const invalidAmount = amountText.trim() !== "" && (typed === null || typed > remaining);
  const amount = typed ?? remaining;
  const full = expectRefunded + amount >= payment.amount;
  const subscription =
    full && org.subscription && org.subscription.status === "active"
      ? t("operator.customers.refundSubscription", { plan: org.subscription.plan })
      : "";
  const description = t("operator.customers.refundConfirm", {
    amount: formatMoney(amount, payment.currency, lang),
    org: org.name || org.slug,
    subscription,
    mail: t("operator.customers.refundMail"),
  });

  return (
    <ActionDialog
      title={t("operator.customers.refundTitle")}
      description={description}
      submitLabel="operator.customers.refund"
      danger
      reason={reason}
      onReasonChange={setReason}
      notice={notice}
      error={error}
      busy={busy}
      canSubmit={!invalidAmount && amount > 0}
      onSubmit={() =>
        void run(async () => {
          try {
            await operatorApi.refund(payment.id, {
              ...(typed !== null && typed < remaining ? { amount: typed } : {}),
              expectRefunded,
              reason,
              requestId: id,
            });
          } catch (caught) {
            if (caught instanceof ApiError && caught.code === "REFUND_STATE_CHANGED") {
              const nowRefunded = Number(caught.details.refunded ?? expectRefunded);
              const currency = String(caught.details.currency ?? payment.currency);
              setExpectRefunded(nowRefunded);
              setNotice(
                t("operator.action.stateChanged", {
                  amount: formatMoney(nowRefunded, currency, lang),
                }),
              );
              setError(null);
              return false;
            }
            throw caught;
          }
          return true;
        })
      }
      onClose={onClose}
    >
      <Input
        label={t("operator.customers.refundAmount")}
        hint={t("operator.customers.refundAllHint")}
        inputMode="numeric"
        value={amountText}
        error={
          invalidAmount
            ? t("operator.action.unavailable", {
                reason: `≤ ${formatMoney(remaining, payment.currency, lang)}`,
              })
            : undefined
        }
        onChange={(event) => setAmountText(event.target.value)}
      />
    </ActionDialog>
  );
}

/* ---------------------------------------------------------------- mark paid -- */

export function MarkPaidDialog({
  org,
  invoice,
  onNeedCode,
  onDone,
  onClose,
}: SubmitProps & {
  org: CustomerOrg;
  invoice: CustomerOrg["invoices"][number];
  onClose: () => void;
}) {
  const { t, lang } = useI18n();
  const [id] = useState(requestId);
  const [reason, setReason] = useState("");
  const [ref, setRef] = useState("");
  const { busy, error, notice, run } = useSubmission({ onNeedCode, onDone });
  const plan = org.subscription?.plan;
  return (
    <ActionDialog
      title={t("operator.customers.markPaidTitle")}
      description={t("operator.customers.markPaidConfirm", {
        number: invoice.number,
        amount: formatMoney(invoice.total, invoice.currency, lang),
        plan: plan ? t("operator.customers.markPaidPlan", { plan }) : "",
      })}
      submitLabel="operator.customers.markPaid"
      reason={reason}
      onReasonChange={setReason}
      notice={notice}
      error={error}
      busy={busy}
      onSubmit={() =>
        void run(async () => {
          await operatorApi.markPaid(invoice.id, {
            reason,
            requestId: id,
            ...(ref.trim() ? { ref: ref.trim() } : {}),
          });
        })
      }
      onClose={onClose}
    >
      <Input
        label={t("operator.customers.markPaidRef")}
        hint={t("operator.customers.markPaidRefHint")}
        value={ref}
        onChange={(event) => setRef(event.target.value)}
      />
    </ActionDialog>
  );
}

/* ------------------------------------------------------------------- credit -- */

export function CreditDialog({
  org,
  onNeedCode,
  onDone,
  onClose,
}: SubmitProps & { org: CustomerOrg; onClose: () => void }) {
  const { t, lang } = useI18n();
  const [id] = useState(requestId);
  const [reason, setReason] = useState("");
  const [amountText, setAmountText] = useState("");
  const currency = org.billing?.currency ?? "RUB";
  const amount = minorUnits(amountText);
  const { busy, error, notice, run } = useSubmission({ onNeedCode, onDone });
  return (
    <ActionDialog
      title={t("operator.customers.creditTitle")}
      description={t("operator.customers.creditConfirm", {
        amount: formatMoney(amount ?? 0, currency, lang),
        org: org.name || org.slug,
      })}
      submitLabel="operator.customers.creditAction"
      reason={reason}
      onReasonChange={setReason}
      notice={notice}
      error={error}
      busy={busy}
      canSubmit={amount !== null}
      onSubmit={() =>
        void run(async () => {
          if (amount === null) return;
          await operatorApi.credit(org.id, { amount, currency, reason, requestId: id });
        })
      }
      onClose={onClose}
    >
      <Input
        label={t("operator.customers.creditAmount")}
        hint={`${currency} · ${t("operator.action.minorUnits")}`}
        inputMode="numeric"
        value={amountText}
        onChange={(event) => setAmountText(event.target.value)}
      />
    </ActionDialog>
  );
}

/* -------------------------------------------------------------------- grant -- */

function dateAfter(days: number): string {
  const date = new Date(Date.now() + days * 86400000);
  return date.toISOString().slice(0, 10);
}

export function GrantDialog({
  org,
  onNeedCode,
  onDone,
  onClose,
}: SubmitProps & { org: CustomerOrg; onClose: () => void }) {
  const { t } = useI18n();
  const [id] = useState(requestId);
  const [reason, setReason] = useState("");
  const [plan, setPlan] = useState(org.subscription?.plan ?? "team");
  const [until, setUntil] = useState(dateAfter(30));
  const { busy, error, notice, run } = useSubmission({ onNeedCode, onDone });
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(until);
  return (
    <ActionDialog
      title={t("operator.customers.grantTitle")}
      description={t("operator.customers.grantConfirm", {
        plan,
        org: org.name || org.slug,
        date: until,
      })}
      submitLabel="operator.customers.grant"
      reason={reason}
      onReasonChange={setReason}
      notice={notice}
      error={error}
      busy={busy}
      canSubmit={valid}
      onSubmit={() =>
        void run(async () => {
          await operatorApi.grant(org.id, { plan, until, reason, requestId: id });
        })
      }
      onClose={onClose}
    >
      <Select
        label={t("operator.customers.grantPlan")}
        value={plan}
        onChange={(event) => setPlan(event.target.value)}
        options={PLANS.map((value) => ({ value, label: value }))}
      />
      <Input
        label={t("operator.customers.grantUntil")}
        type="date"
        value={until}
        onChange={(event) => setUntil(event.target.value)}
      />
    </ActionDialog>
  );
}

/* ------------------------------------------------------------------ measure -- */

/** A pasted room address becomes its id; a bare id stays as typed. */
export function roomIdFrom(value: string): string {
  const text = value.trim();
  if (!text) return "";
  try {
    // A pasted address may be absolute or the console's own relative `/?room=…`.
    const url = new URL(text, "http://operator.local");
    const fromQuery = url.searchParams.get("room");
    if (fromQuery) return fromQuery;
    const parts = url.pathname.split("/").filter(Boolean);
    return parts[parts.length - 1] ?? text;
  } catch {
    return text;
  }
}

export function MeasureDialog({
  org = null,
  initialRoom = "",
  onNeedCode,
  onDone,
  onClose,
}: SubmitProps & {
  org?: CustomerOrg | null;
  initialRoom?: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [id] = useState(requestId);
  const [reason, setReason] = useState("");
  const [kind, setKind] = useState(org ? "org_suspend" : "link_disable");
  const [roomText, setRoomText] = useState(initialRoom);
  const { busy, error, notice, run } = useSubmission({ onNeedCode, onDone });

  const resolvedTarget = org ? org.id : roomIdFrom(roomText);
  const kinds = org ? ["org_suspend"] : ["link_disable", "board_hide"];
  const targetLabel = org ? org.name || org.slug : resolvedTarget || t("operator.measures.noTarget");
  return (
    <ActionDialog
      title={t("operator.measures.newTitle")}
      description={t("operator.measures.newConfirm", {
        kind: t(measureKindKey(kind)),
        target: targetLabel,
      })}
      submitLabel="operator.measures.new"
      danger
      reason={reason}
      onReasonChange={setReason}
      notice={notice}
      error={error}
      busy={busy}
      canSubmit={Boolean(resolvedTarget) && kinds.includes(kind)}
      onSubmit={() =>
        void run(async () => {
          await operatorApi.measure({
            kind,
            target: resolvedTarget,
            reason,
            requestId: id,
          });
        })
      }
      onClose={onClose}
    >
      {org ? (
        <p className="operator-note">{org.name || org.slug}</p>
      ) : (
        <Input
          label={t("operator.measures.targetRoom")}
          hint={t("operator.measures.targetRoomHint")}
          value={roomText}
          onChange={(event) => setRoomText(event.target.value)}
        />
      )}
      <Select
        label={t("operator.measures.kind")}
        value={kind}
        onChange={(event) => setKind(event.target.value)}
        options={kinds.map((value) => ({
          value,
          label: t(measureKindKey(value)),
        }))}
      />
      {!org && !resolvedTarget && <p className="operator-notice">{t("operator.measures.needTarget")}</p>}
    </ActionDialog>
  );
}

/* ------------------------------------------------------------------- revert -- */

export function RevertDialog({
  action,
  onNeedCode,
  onDone,
  onClose,
}: SubmitProps & { action: OperatorMeasure; onClose: () => void }) {
  const { t } = useI18n();
  const [id] = useState(requestId);
  const [reason, setReason] = useState("");
  const { busy, error, notice, run } = useSubmission({ onNeedCode, onDone });
  const target = action.boardTitle || action.orgName || action.subjectId;
  return (
    <ActionDialog
      title={t("operator.measures.revertTitle")}
      description={t("operator.measures.revertConfirm", {
        kind: t(measureKindKey(action.kind)),
        target,
      })}
      submitLabel="operator.measures.revert"
      reason={reason}
      onReasonChange={setReason}
      notice={notice}
      error={error}
      busy={busy}
      onSubmit={() =>
        void run(async () => {
          await operatorApi.revertMeasure(action.id, { reason, requestId: id });
        })
      }
      onClose={onClose}
    />
  );
}
