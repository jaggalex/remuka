import { useEffect, useState } from "react";
import { billingApi, formatMoney, TERMS_VERSION, type BillingSubscription, type CheckoutResult, type PlanChangeQuote } from "./apiBilling";
import { formatDay } from "./BillingStatusBanner";
import { ApiError } from "./apiCall";
import { checkoutErrorKey } from "./billingCheckoutError";
import { useI18n, type TranslationKey } from "./i18n";

const PLAN_KEY: Record<string, TranslationKey> = {
  free: "billing.plan.free", pro: "billing.plan.pro", team: "billing.plan.team",
  business: "billing.plan.business", unlimited: "billing.plan.unlimited",
};

/**
 * The toast after a scheduled downgrade is cancelled (ADR-319): no letter is sent, so
 * the screen says what carries on and what the next charge is.
 */
export function cancelledNotice(
  t: (key: TranslationKey, values?: Record<string, string | number>) => string,
  current: BillingSubscription | null | undefined,
  lang: "ru" | "en",
): string {
  if (!current) return "";
  const plan = t(PLAN_KEY[current.plan] ?? "billing.plan.free");
  if (current.cancelAtPeriodEnd || !current.amount) return t("billing.change.cancelledPlain", { plan });
  return t("billing.change.cancelled", {
    plan,
    date: formatDay(current.currentPeriodEnd, lang),
    amount: formatMoney(current.amount, current.currency, lang),
  });
}

type Props = {
  orgId: string;
  method: string;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  setActionError: (error: string | null) => void;
  setCheckout: (checkout: CheckoutResult) => void;
  setChoosing: (choosing: boolean) => void;
  read: () => Promise<void>;
  refreshChange: () => void;
};

function returningPayment(orgId: string) {
  const query = new URLSearchParams(window.location.search);
  return query.get("billing") === "return" && query.get("org") === orgId ? query.get("payment") : null;
}

export function useBillingChange({ orgId, method, busy, setBusy, setActionError,
  setCheckout, setChoosing, read, refreshChange }: Props) {
  const { t, lang } = useI18n();
  const [changeQuote, setChangeQuote] = useState<PlanChangeQuote | null>(null);
  const [quoteExpired, setQuoteExpired] = useState(false);
  const [changeAutopay, setChangeAutopay] = useState(false);
  const [paymentId, setPaymentId] = useState(() => returningPayment(orgId));
  const [changeNotice, setChangeNotice] = useState<string | null>(null);
  const [dismissedPayment, setDismissedPayment] = useState<string | null>(null);

  useEffect(() => {
    setChangeQuote(null);
    setPaymentId(returningPayment(orgId));
    setDismissedPayment(null);
  }, [orgId]);

  const previewChange = async (target: string) => {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      setChangeQuote(await billingApi.previewChange(orgId, target));
      setQuoteExpired(false);
      setChangeAutopay(false);
    } catch (failure) {
      const code = failure instanceof ApiError ? failure.code : "";
      setActionError(t(checkoutErrorKey(code)));
    } finally {
      setBusy(false);
    }
  };

  const submitChange = async (renewalInvoiceId?: string) => {
    if (busy || !renewalInvoiceId && !changeQuote) return;
    setBusy(true);
    setActionError(null);
    try {
      const result = await billingApi.confirmChange(orgId, {
        ...(renewalInvoiceId ? { invoiceId: renewalInvoiceId } : {
          priceId: changeQuote?.priceId,
          key: changeQuote?.key,
        }),
        methodGroup: method,
        consent: {
          autopay: Boolean(changeAutopay && changeQuote?.autopayMethods.includes(method)),
          termsVersion: TERMS_VERSION,
        },
        locale: lang,
      });
      if (result.redirectUrl) {
        window.location.assign(result.redirectUrl);
        return;
      }
      if (result.paymentId) setPaymentId(result.paymentId);
      if (result.widget && result.invoiceId && result.paymentId) {
        setCheckout({
          invoiceId: result.invoiceId, paymentId: result.paymentId, amount: result.amount ?? 0,
          currency: result.currency ?? "", widget: result.widget, redirectUrl: null,
        });
      }
      setChangeQuote(null);
      setChoosing(false);
      refreshChange();
    } catch (failure) {
      const code = failure instanceof ApiError ? failure.code : "";
      if (code === "QUOTE_EXPIRED") setQuoteExpired(true);
      else setActionError(t(checkoutErrorKey(code)));
      if (code === "PAYMENT_UNCERTAIN" || code === "OPERATION_IN_PROGRESS") {
        setChangeQuote(null);
        setChoosing(false);
        refreshChange();
      }
    } finally {
      setBusy(false);
    }
  };

  const cancelScheduled = async (notice = "") => {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    setChangeNotice(null);
    try {
      await billingApi.cancelChange(orgId);
      await read();
      if (notice) setChangeNotice(notice);
    } catch (failure) {
      const code = failure instanceof ApiError ? failure.code : "";
      setActionError(t(checkoutErrorKey(code)));
    } finally {
      setBusy(false);
    }
  };

  return { changeQuote, setChangeQuote, quoteExpired, changeAutopay, setChangeAutopay, paymentId,
    dismissedPayment, setDismissedPayment, previewChange, submitChange, cancelScheduled, changeNotice };
}
