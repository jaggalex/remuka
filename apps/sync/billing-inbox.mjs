/**
 * The inbound payment journal drain and the hourly reconciliation
 * (`spec/payment-providers.md` §5, §5.1; ADR-248).
 *
 * A webhook only records the verified event; the money changes here. One pass claims a
 * batch with a five-minute lease, finds the payment behind the event, applies the status
 * **forward only** and then the billing consequences a manual confirmation would have:
 * the invoice is paid, the credit is spent, the period opens, `billing_events` gets its
 * row and the payer gets the letter. The saved method of §4 is stored in the same pass, so
 * there is one order rather than two.
 *
 * Idempotency is layered, because a provider repeats deliveries and the reconciliation
 * repeats an event too:
 *   - `provider_event_key` is unique per connection, so the same delivery is one row;
 *   - `markInvoicePaid` writes `invoice.paid` only while the invoice is open;
 *   - a status that is already `succeeded` (or `canceled`) is a no-op with a reason in
 *     `last_error`, never a regression;
 *   - a payment is updated through its checkout row, so one attempt stays one row.
 *
 * Failure handling mirrors the mail drain: the shared `backoffMs` ladder, eight attempts,
 * then `dead_at` and a metric. The row is never deleted, so the operator can see it.
 */
import { backoffMs } from "./backoff.mjs";
import { settleInvoice } from "./billing-settle.mjs";
import { paymentAdapters } from "./payment-adapters.mjs";
import { openConnectionSecret } from "./payment-connections.mjs";
import { kekFromEnv } from "./secrets.mjs";
import { applyProviderEvent } from "./payment-webhooks.mjs";

/** Eight attempts: 5 s, 15 s, 1 min, 5 min, 15 min, 30 min, then an hour each. */
export const INBOX_SCHEDULE = Object.freeze([
  5_000,
  15_000,
  60_000,
  300_000,
  900_000,
  1_800_000,
  3_600_000,
  3_600_000,
]);
export const INBOX_MAX_ATTEMPTS = 8;

/** A payment older than this is due for reconciliation (§5.1). */
export const RECONCILE_AFTER_MS = 15 * 60 * 1000;

/** One hour between reconciliation passes, riding the drain's timer. */
export const RECONCILE_EVERY_MS = 60 * 60 * 1000;

const MONEY_STATUSES = new Set(["succeeded", "canceled"]);

function short(id) {
  return String(id ?? "").slice(0, 8);
}

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

/** `payload.payment` is the normalized object the adapter wrote, never a provider body. */
function normalizedPayment(event) {
  const payment = event?.payment ?? event?.payload?.payment;
  return payment && typeof payment === "object" ? payment : null;
}

/**
 * What a provider status means to a payment row that already has one.
 *
 * `apply` is the only outcome that may touch money; `repeat` is the same status again and
 * `stale` is an older fact arriving after a newer one. Both are no-ops, but the journal
 * keeps the difference in `last_error`.
 */
export function paymentTransition(current, next) {
  if (!MONEY_STATUSES.has(next)) return "ignore";
  if (current === next) return "repeat";
  if (current === "pending") return "apply";
  // `succeeded` is the furthest a payment goes here; `canceled` never wins it back.
  return "stale";
}

/**
 * The payment behind one event: our `paymentId` first, then the provider id inside the
 * same connection. A payment id from another connection is not ours, whatever the
 * metadata says, so it falls through to the provider id instead of settling a stranger.
 */
export async function resolvePayment({ store, event, connectionId = null }) {
  const payload = event?.payload ?? event ?? {};
  const ourId =
    typeof payload.paymentId === "string"
      ? payload.paymentId.trim()
      : typeof event?.paymentId === "string"
        ? event.paymentId.trim()
        : "";
  const connection = connectionId ?? event?.connection_id ?? null;

  if (ourId && typeof store.paymentChainFor === "function") {
    const chain = await store.paymentChainFor(ourId);
    if (chain && (!connection || chain.connection_id === connection)) return chain;
  }
  const providerPaymentId = normalizedPayment(event)?.providerPaymentId;
  if (
    providerPaymentId &&
    connection &&
    typeof store.paymentChainByProviderId === "function"
  ) {
    return store.paymentChainByProviderId({ connectionId: connection, providerPaymentId });
  }
  return null;
}

/**
 * Apply one normalized event to the ledger. Returns the outcome instead of throwing for
 * every no-op; only a condition that a retry may cure (a missing payment, a database
 * error) throws and lets the drain schedule the next attempt.
 */
export async function applyPaymentEvent({
  store,
  connectionId,
  event,
  notify = null,
  kek = null,
  log = console,
}) {
  if (event?.type !== "payment.updated") {
    return { applied: false, reason: "IGNORED" };
  }
  const payment = normalizedPayment(event);
  const next = payment?.status;
  if (!MONEY_STATUSES.has(next)) return { applied: false, reason: "IGNORED" };

  const chain = await resolvePayment({ store, event, connectionId });
  if (!chain) throw codedError("PAYMENT_NOT_FOUND", "the event names no known payment");

  const orgId = chain.org_id ?? null;
  const transition = paymentTransition(chain.payment_status, next);
  if (transition === "repeat") return { applied: false, reason: "ALREADY_APPLIED", orgId };
  if (transition === "stale") return { applied: false, reason: "STALE", orgId };

  if (next === "canceled") {
    const canceled = await store.cancelPayment({
      paymentId: chain.payment_id,
      failureCode: payment.failureCode ?? null,
    });
    if (!canceled) return { applied: false, reason: "STALE", orgId };
    log.log?.(`[billing] inbox: payment ${short(chain.payment_id)} canceled`);
    return { applied: true, reason: null, orgId };
  }

  const invoice = await store.billingInvoiceGlobal(chain.invoice_id);
  if (!invoice) throw codedError("INVOICE_NOT_FOUND", "the payment has no invoice");
  if (invoice.status === "void") {
    return { applied: false, reason: "INVOICE_VOID", orgId };
  }
  if (invoice.status === "paid" && chain.payment_status === "succeeded") {
    // Another event (the reconciliation, a repeated delivery with a new key) already
    // settled this payment. Money is a fact; a second letter or ledger row is not.
    return { applied: false, reason: "ALREADY_APPLIED", orgId };
  }
  // The provider's sum is the fact; the invoice's is the promise. Settling a 1 ₽ payment
  // against a 290 ₽ invoice would grant a period that nobody paid for, so the mismatch
  // is retried (and finally buried) instead of guessed around.
  if (
    Number.isFinite(payment.amount) &&
    payment.amount > 0 &&
    payment.amount !== Number(invoice.total)
  ) {
    throw codedError("AMOUNT_MISMATCH", "the provider's amount differs from the invoice");
  }
  if (
    typeof payment.currency === "string" &&
    payment.currency !== "" &&
    payment.currency.toUpperCase() !== String(invoice.currency).toUpperCase()
  ) {
    throw codedError("CURRENCY_MISMATCH", "the provider's currency differs from the invoice");
  }

  // The saved method belongs to the first successful payment of a subscription (§4) and
  // is stored before the settlement, so a failed settlement retries the same event rather
  // than leaving a paid invoice with an autopay promise and no card.
  if (typeof store.connectionById === "function") {
    const connection = await store.connectionById(chain.connection_id);
    if (connection) {
      try {
        await applyProviderEvent({
          store,
          connection,
          event,
          log,
          ...(kek ? { kek } : {}),
        });
      } catch (error) {
        log.error?.(
          `[billing] inbox: the method of payment ${short(chain.payment_id)} was not saved (${error?.code ?? "ERROR"})`,
        );
      }
    }
  }

  const settled = await settleInvoice({
    store,
    invoice,
    connectionId: chain.connection_id,
    providerPaymentId: payment.providerPaymentId ?? null,
    paymentId: chain.payment_id,
  });

  if (notify) {
    try {
      await notify("payment_succeeded", {
        orgId,
        invoice: settled.invoice,
        subscription: settled.subscription,
      });
    } catch (error) {
      // The money is stored; a letter that failed must not make the provider repeat an
      // event whose ledger consequences are already applied.
      log.error?.(`[billing] inbox: payment_succeeded letter failed (${error?.code ?? "ERROR"})`);
    }
  }
  log.log?.(`[billing] inbox: payment ${short(chain.payment_id)} succeeded`);
  return { applied: true, reason: null, orgId };
}

export function createBillingInbox({
  store,
  adapters = paymentAdapters(),
  notify = null,
  log = console,
  metrics = null,
  kek = null,
  fetchImpl,
  now = () => Date.now(),
  intervalMs = 2000,
  batch = 10,
  reconcileEveryMs = RECONCILE_EVERY_MS,
}) {
  let timer = null;
  let running = false;
  let reconciling = false;
  // The core reconciliation runs at boot for anything already overdue, then hourly.
  let lastReconcile = Number.NEGATIVE_INFINITY;

  async function processRow(row) {
    let orgId = row.org_id ?? null;
    try {
      const outcome = await applyPaymentEvent({
        store,
        connectionId: row.connection_id,
        event: row.payload ?? {},
        notify,
        kek,
        log,
      });
      orgId = outcome.orgId ?? orgId;
      await store.markProviderEventProcessed({
        id: row.id,
        orgId,
        reason: outcome.reason,
      });
      if (outcome.applied) metrics?.inc("remo_billing_events_applied_total");
      return outcome;
    } catch (error) {
      const code = error?.code ?? error?.name ?? "INBOX_ERROR";
      const attempts = (row.attempts ?? 0) + 1;
      if (attempts >= INBOX_MAX_ATTEMPTS) {
        await store.markProviderEventDead({ id: row.id, attempts, error: code, orgId });
        metrics?.inc("remo_billing_events_dead_total", { code });
        log.error(`[billing] inbox dead ${short(row.id)} ${code}`);
        return { applied: false, reason: code, dead: true };
      }
      const nextAttemptAt = new Date(now() + backoffMs(attempts, INBOX_SCHEDULE));
      await store.markProviderEventRetry({
        id: row.id,
        attempts,
        error: code,
        nextAttemptAt,
        orgId,
      });
      metrics?.inc("remo_billing_events_failed_total", { code });
      log.log(`[billing] inbox retry ${attempts}/${INBOX_MAX_ATTEMPTS} ${short(row.id)} ${code}`);
      return { applied: false, reason: code, retry: true };
    }
  }

  async function drain() {
    if (running || typeof store.claimProviderEventBatch !== "function") return 0;
    running = true;
    try {
      const rows = await store.claimProviderEventBatch(batch, { now: new Date(now()) });
      for (const row of rows) await processRow(row);
      return rows.length;
    } catch (error) {
      log.error(`[billing] inbox drain failed: ${error?.message ?? error}`);
      return 0;
    } finally {
      running = false;
    }
  }

  /**
   * Ask the provider about payments that never got a notification. The answer is written
   * back into the same inbox under `reconcile:{payment}:{status}`, so the drain applies it
   * with the same rules; a failure here is one logged payment and the next hour retries.
   */
  async function reconcile() {
    if (reconciling || typeof store.pendingPaymentsForReconcile !== "function") {
      return { checked: 0 };
    }
    reconciling = true;
    const checked = [];
    try {
      const cutoff = new Date(now() - RECONCILE_AFTER_MS);
      const pending = await store.pendingPaymentsForReconcile({ olderThan: cutoff, limit: 50 });
      for (const payment of pending) {
        try {
          const connection = await store.connectionById(payment.connection_id);
          const adapter = connection ? adapters[connection.provider] : null;
          if (!connection || typeof adapter?.getPayment !== "function") continue;

          let usable = connection;
          if (connection.has_secret || connection.ciphertext) {
            usable = {
              ...connection,
              secret: openConnectionSecret(connection, { kek: kek ?? kekFromEnv() }),
            };
          }
          const answer = await adapter.getPayment(usable, payment.provider_payment_id, {
            fetchImpl,
          });
          const status = answer?.status;
          // `pending` is not news; `failed` is a distinct outcome the inbox does not
          // apply, so only the two money statuses are written back.
          if (!MONEY_STATUSES.has(status)) {
            checked.push({ id: payment.id, status: status ?? "unknown" });
            continue;
          }
          await store.recordProviderEvent({
            connectionId: payment.connection_id,
            providerEventKey: `reconcile:${payment.id}:${status}`,
            type: "payment.updated",
            orgId: payment.org_id,
            payload: { type: "payment.updated", paymentId: payment.id, payment: answer },
          });
          checked.push({ id: payment.id, status });
        } catch (error) {
          // One unreachable shop or bad payment must not stop the rest of the hour.
          log.error?.(
            `[billing] reconcile ${short(payment.id)}: ${error?.code ?? "ERROR"}`,
          );
          checked.push({ id: payment.id, status: "error" });
        }
      }
      if (checked.some((item) => MONEY_STATUSES.has(item.status))) await drain();
      return { checked: checked.length, payments: checked };
    } finally {
      reconciling = false;
    }
  }

  async function tick() {
    await drain();
    if (now() - lastReconcile >= reconcileEveryMs) {
      lastReconcile = now();
      await reconcile();
    }
  }

  /** Called once on listen; a disk store has no inbox to drain. */
  function start() {
    if (timer) return;
    timer = setInterval(() => {
      void tick().catch((error) => {
        log.error?.(`[billing] inbox tick failed: ${error?.code ?? "ERROR"}`);
      });
    }, intervalMs);
    timer.unref?.();
  }

  function stop() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  }

  return { drain, reconcile, tick, start, stop };
}
