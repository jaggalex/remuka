import { openPaymentMethodRef } from "./billing-renewals.mjs";
import { settleInvoice } from "./billing-settle.mjs";
import { paymentAdapters } from "./payment-adapters.mjs";
import { openConnectionSecret } from "./payment-connections.mjs";
import { subscriptionLine } from "./pg/billing-change.mjs";
import { kekFromEnv } from "./secrets.mjs";

export function createBillingCharge(store) {
  return async ({ subscription, invoice, idempotencyKey }) => {
    if (process.env.REMO_BILLING !== "on") throw new Error("billing is off");
    const line = subscriptionLine(invoice);
    const scheduled = line?.planChange?.type === "downgrade";
    if (scheduled && subscription.cancel_at_period_end) return { status: "failed", failureCode: "manual_payment_required" };
    const connection = await store.connectionById(subscription.connection_id);
    const adapter = connection ? paymentAdapters()[connection.provider] : null;
    if (!connection || typeof adapter?.chargeSaved !== "function") throw new Error("this connection cannot renew");
    const method = await store.withTenant(subscription.org_id, () => store.paymentMethod(subscription.org_id));
    if (!method) throw new Error("no saved payment method");
    const kek = kekFromEnv();
    const usable = connection.has_secret || connection.ciphertext
      ? { ...connection, secret: openConnectionSecret(connection, { kek }) }
      : connection;
    const request = {
      paymentId: invoice.id, idempotencyKey, methodRef: openPaymentMethodRef(method, { kek }),
      amount: Number(invoice.total), currency: invoice.currency, description: `Subscription ${line?.plan ?? subscription.plan}`,
    };
    if (!scheduled) return adapter.chargeSaved(usable, request);

    return store.withTenant(subscription.org_id, async () => {
      let attempt;
      try {
        attempt = await store.openChangePayment(subscription.org_id, invoice.id, connection.id);
      } catch (failure) {
        if (failure.code === "OPERATION_IN_PROGRESS") return { status: "pending" };
        throw failure;
      }
      let result;
      try {
        result = await adapter.chargeSaved(usable, {
          ...request, paymentId: attempt.id, idempotencyKey: attempt.idempotency_key,
        });
      } catch {
        // The provider might have accepted the request. Keep the attempt pending for its webhook.
        return { status: "pending" };
      }
      if (result.providerPaymentId) await store.attachProviderPaymentId(attempt.id, result.providerPaymentId);
      if (result.status === "succeeded") {
        if (Number(result.amount) !== Number(invoice.total) || result.currency !== invoice.currency) {
          return { status: "pending" };
        }
        await settleInvoice({
          store, invoice, paymentId: attempt.id, connectionId: connection.id,
          providerPaymentId: result.providerPaymentId,
        });
      } else if (result.status === "failed" || result.status === "canceled") {
        await store.cancelPayment({ paymentId: attempt.id, failureCode: result.failureCode });
      }
      return result;
    });
  };
}
