import { useEffect, useState } from "react";
import { billingApi, TERMS_VERSION, type CheckoutResult, type PlanChangeQuote } from "./apiBilling";
import { ApiError } from "./apiCall";
import { checkoutErrorKey } from "./billingCheckoutError";
import { useI18n } from "./i18n";

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

  const cancelScheduled = async () => {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await billingApi.cancelChange(orgId);
      await read();
    } catch (failure) {
      const code = failure instanceof ApiError ? failure.code : "";
      setActionError(t(checkoutErrorKey(code)));
    } finally {
      setBusy(false);
    }
  };

  return { changeQuote, setChangeQuote, quoteExpired, changeAutopay, setChangeAutopay, paymentId,
    dismissedPayment, setDismissedPayment, previewChange, submitChange, cancelScheduled };
}
