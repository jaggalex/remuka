import { createHash } from "node:crypto";
import { PLAN_NAMES, PLANS } from "../billing-catalog.mjs";
import { periodEnd, prorationCredit } from "../billing-money.mjs";
import { codedError } from "./billing-money.mjs";

const QUOTE_WINDOW = 5 * 60_000;

export function lockBillingChange(client, orgId) {
  return client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `billing-change:${orgId}`,
  ]);
}

export async function billingChangeTransaction(store, orgId, run) {
  return store.withTenant(orgId, async () => {
    const client = await store.pool.connect();
    try {
      await client.query("begin");
      await lockBillingChange(client, orgId);
      const result = await run(client);
      await client.query("commit");
      return result;
    } catch (failure) {
      await client.query("rollback").catch(() => {});
      throw failure;
    } finally {
      client.release();
    }
  });
}

export function subscriptionLine(invoice) {
  return Array.isArray(invoice?.lines) ? invoice.lines.find(line => line?.kind === "subscription") : null;
}

async function note(client, orgId, type, subject, details) {
  await client.query(
    "insert into billing_events (org_id, type, subject_id, data) values ($1, $2, $3, $4::jsonb)",
    [orgId, type, subject, JSON.stringify(details)],
  );
}

async function currentSubscription(client, orgId) {
  const { rows: [row] } = await client.query(
    "select * from subscriptions where org_id = $1 and status = 'active' for update",
    [orgId],
  );
  return row;
}

export async function findPendingUpgrade(client, orgId, includeRenewal = false) {
  const { rows: [row] } = await client.query(
    `select i.id, i.number, i.lines, p.id as payment_id
       from invoices i join payments p on p.invoice_id = i.id
      where i.org_id = $1 and i.status = 'open' and p.status = 'pending'
        and (i.lines @> '[{"planChange":{"type":"upgrade"}}]'::jsonb
          or ($2::boolean and i.lines @> '[{"planChange":{"type":"downgrade"}}]'::jsonb))
      order by i.created_at desc limit 1`,
    [orgId, includeRenewal],
  );
  return row ?? null;
}

async function requireNoUpgrade(client, orgId) {
  if (await findPendingUpgrade(client, orgId)) {
    throw codedError("OPERATION_IN_PROGRESS", "a plan change payment is pending");
  }
}

async function quote(store, client, orgId, priceId, now) {
  const current = await currentSubscription(client, orgId);
  if (!current || +new Date(current.current_period_end) <= now) {
    throw codedError("CHANGE_UNAVAILABLE", "the current paid period must still be active");
  }
  const price = priceId === "free"
    ? { id: "free", plan: "free", currency: current.currency, interval: current.interval, amount: 0 }
    : await store.priceById(priceId);
  if (!price || !Object.hasOwn(PLANS, price.plan) || (priceId !== "free" &&
      (price.status !== "for_sale" || price.promo_only || price.currency !== current.currency))) {
    throw codedError("CHANGE_UNAVAILABLE", "the target price is not available");
  }
  if (current.plan === price.plan && current.interval === price.interval) {
    throw codedError("CHANGE_UNAVAILABLE", "this plan and interval are already active");
  }

  const start = +new Date(current.current_period_start);
  const end = +new Date(current.current_period_end);
  const downgrade = PLAN_NAMES.indexOf(price.plan) < PLAN_NAMES.indexOf(current.plan)
    || (current.interval === "year" && price.interval === "month");
  const targetAmount = Number(price.amount);
  const bucket = Math.floor(now / QUOTE_WINDOW) * QUOTE_WINDOW;
  const at = Math.max(start, bucket);
  let credit = 0;
  if (!downgrade) {
    const { rows: [paid] } = await client.query(
      `select i.subtotal, i.discount, i.lines, coalesce((
            select sum(r.amount) from refunds r join payments p on p.id = r.payment_id
             where p.invoice_id = i.id and r.status = 'succeeded'
          ), 0) as refunded
        from invoices i where i.org_id = $1 and i.status = 'paid' and i.period_end = $2
          and lines @> $3::jsonb
        order by paid_at desc limit 1`,
      [orgId, current.current_period_end, JSON.stringify([{ kind: "subscription", plan: current.plan }])],
    );
    const { rows: [renewed] } = paid ? { rows: [] } : await client.query(
      `select data from billing_events
        where org_id = $1 and type = 'subscription.renewed' and subject_id = $2
          and data->>'periodEnd' = $3
        order by occurred_at desc limit 1`,
      [orgId, current.id, new Date(end).toISOString()],
    );
    const basis = paid
      ? Math.max(0, Number(paid.subtotal) - (subscriptionLine(paid)?.planChange ? 0 : Number(paid.discount)) - Number(paid.refunded))
      : Number(renewed?.data?.amount ?? 0);
    credit = at === start ? basis : prorationCredit({ amount: basis, periodStart: start, periodEnd: end, at });
    if (credit > targetAmount) throw codedError("CHANGE_UNAVAILABLE", "the unused amount exceeds the target price");
  }
  const expiresAt = new Date(Math.min(bucket + QUOTE_WINDOW, end));
  const key = createHash("sha256").update(JSON.stringify([
    current.id, current.plan, current.price_id, start, end, current.pending_change, price.id, targetAmount, credit, +expiresAt,
  ])).digest("base64url");
  const details = {
    key, type: downgrade ? "downgrade" : "upgrade", expiresAt,
    fromPlan: current.plan, fromAmount: Number(current.amount), fromInterval: current.interval,
    fromPeriodEnd: current.current_period_end, plan: price.plan, priceId: price.id,
    interval: price.interval, currency: price.currency, amount: targetAmount, credit,
    total: downgrade ? 0 : targetAmount - credit,
    effectiveAt: downgrade ? new Date(end) : new Date(now),
    nextPeriodEnd: downgrade ? null : periodEnd(now, price.interval),
    limits: PLANS[price.plan], previousLimits: PLANS[current.plan],
  };
  return { current, details };
}

async function updateSchedule(client, current, scheduled, actorId) {
  await client.query("update subscriptions set pending_change = $2::jsonb, updated_at = now() where id = $1", [
    current.id, JSON.stringify(scheduled),
  ]);
  const type = scheduled ? "subscription.change_scheduled" : "subscription.change_canceled";
  await note(client, current.org_id, type, current.id, { actorId, from: current.pending_change, to: scheduled });
}

export async function applyPaidChange(client, invoice, line) {
  const change = line.planChange;
  const starts = change.type === "upgrade" ? invoice.paid_at : invoice.period_start;
  const ends = change.type === "upgrade" ? periodEnd(starts, line.interval) : invoice.period_end;
  const { rows: [current] } = await client.query(
    `update subscriptions set plan = $2, price_id = $3, interval = $4, amount = $5,
        current_period_start = $6, current_period_end = $7, status = 'active',
        pending_change = null, past_due_since = null, suspended_at = null, canceled_at = null,
        discount = null, cancel_at_period_end = case when $10::boolean is null then cancel_at_period_end else $10 end,
        updated_at = now()
      where id = $1 and org_id = $8 and current_period_end = $9 and plan = $11 and price_id = $12
        and status in ('active', 'past_due', 'suspended')
      returning *`,
    [invoice.subscription_id, line.plan, line.priceId, line.interval, line.amount, starts, ends,
      invoice.org_id, change.fromPeriodEnd, change.type === "upgrade" ? !line.autopayConsent : null, change.fromPlan, change.fromPriceId],
  );
  if (!current) {
    // The external money is real even if an operator changed the subscription meanwhile.
    await note(client, invoice.org_id, "subscription.change_review", invoice.id, { invoiceId: invoice.id, change });
    return false;
  }
  if (change.type === "upgrade") {
    await client.query("update invoices set period_start = $2, period_end = $3 where id = $1", [invoice.id, starts, ends]);
    invoice.period_start = starts;
    invoice.period_end = ends;
  }
  await note(client, invoice.org_id, "subscription.change_applied", current.id, {
    invoiceId: invoice.id, from: change.fromPlan, to: line.plan, periodStart: starts, periodEnd: ends,
  });
  return true;
}

export const billingChangeMethods = {
  async previewPlanChange(orgId, priceId, now = Date.now()) {
    return billingChangeTransaction(this, orgId, async client => (await quote(this, client, orgId, priceId, now)).details);
  },

  async confirmPlanChange({ orgId, priceId, key, actorId, checkout, now = Date.now() }) {
    return billingChangeTransaction(this, orgId, async client => {
      await requireNoUpgrade(client, orgId);
      const { current, details } = await quote(this, client, orgId, priceId, now);
      if (key !== details.key) throw codedError("QUOTE_EXPIRED", "the calculation has changed");
      if (details.type === "downgrade") {
        const scheduled = { plan: details.plan, priceId, interval: details.interval,
          amount: details.amount, currency: details.currency, at: details.effectiveAt };
        await updateSchedule(client, current, scheduled, actorId);
        return { scheduled };
      }
      const line = {
        kind: "subscription", plan: details.plan, priceId, interval: details.interval, amount: details.amount,
        ...checkout?.autopay,
        planChange: { type: "upgrade", fromPlan: current.plan, fromPriceId: current.price_id, fromPeriodEnd: details.fromPeriodEnd, actorId },
      };
      const lines = [line, { kind: "proration_credit", amount: -details.credit }];
      const { invoice } = await this.createInvoice({
        orgId, subscriptionId: current.id, currency: details.currency, lines,
        subtotal: details.amount, discount: details.credit, total: details.total,
        dueAt: details.expiresAt, now: new Date(now), transaction: client,
      });
      if (details.total === 0) {
        await applyPaidChange(client, invoice, line);
        await this.reconcileFrozenRooms(orgId, PLANS[line.plan].rooms, { transaction: client });
        return { invoice, applied: true };
      }
      const payment = await this.recordPayment({
        orgId, invoiceId: invoice.id, connectionId: checkout.connectionId,
        idempotencyKey: `checkout:${invoice.id}`, amount: invoice.total, currency: invoice.currency,
      });
      return { invoice, payment };
    });
  },

  async cancelPlanChange(orgId, actorId, now = Date.now()) {
    return billingChangeTransaction(this, orgId, async client => {
      const current = await currentSubscription(client, orgId);
      if (!current?.pending_change || +new Date(current.current_period_end) <= now) {
        throw codedError("CHANGE_UNAVAILABLE", "there is no change that can be canceled");
      }
      await updateSchedule(client, current, null, actorId);
    });
  },

  async pendingPlanPayment(orgId) {
    const row = await findPendingUpgrade(this.pool, orgId, true);
    return row ? { paymentId: row.payment_id, invoiceNumber: row.number, plan: subscriptionLine(row).plan } : null;
  },

  async planChangeApplied(orgId, invoiceId) {
    const { rowCount } = await this.pool.query(
      `select 1 from billing_events where org_id = $1 and type = 'subscription.change_applied'
        and data->>'invoiceId' = $2 limit 1`, [orgId, invoiceId],
    );
    return rowCount > 0;
  },

  async openChangePayment(orgId, invoiceId, connectionId) {
    return billingChangeTransaction(this, orgId, async client => {
      const invoice = await this.invoiceById(orgId, invoiceId);
      const line = subscriptionLine(invoice);
      if (invoice?.status !== "open" || line?.planChange?.type !== "downgrade") {
        throw codedError("CHANGE_UNAVAILABLE", "the renewal invoice is not open");
      }
      const { rows } = await client.query("select status from payments where invoice_id = $1", [invoiceId]);
      if (rows.some(row => row.status === "pending")) {
        throw codedError("OPERATION_IN_PROGRESS", "a change payment is pending");
      }
      return this.recordPayment({
        orgId, invoiceId, connectionId, idempotencyKey: `invoice:${invoiceId}:attempt:${rows.length + 1}`,
        amount: invoice.total, currency: invoice.currency,
      });
    });
  },

  async finishScheduledFree(subscription, now) {
    return billingChangeTransaction(this, subscription.org_id, async client => {
      const current = await currentSubscription(client, subscription.org_id);
      if (!current || current.pending_change?.plan !== "free" || +new Date(current.current_period_end) > now
        || await findPendingUpgrade(client, current.org_id)) return false;
      await client.query(
        "update subscriptions set status = 'canceled', pending_change = null, canceled_at = now(), updated_at = now() where id = $1",
        [current.id],
      );
      await this.reconcileFrozenRooms(current.org_id, PLANS.free.rooms, { transaction: client });
      await note(client, current.org_id, "subscription.change_applied", current.id, { from: current.plan, to: "free" });
      return true;
    });
  },
};
