/**
 * Checkout and invoices (ADR-247, `spec/billing.md` §3.4, §4, §6).
 *
 * Stage 2 sells by bank invoice only: the provider adapter creates a payment with
 * instructions, and an operator marks it paid with `pnpm billing:mark-paid`. The money
 * arithmetic lives in `billing-money.mjs`, the ledger in `pg/billing-money.mjs`; this
 * file only decides what to sell, to whom, and in which currency.
 */
import { paymentAdapters } from "./payment-adapters.mjs";
import { openConnectionSecret } from "./payment-connections.mjs";
import { kekFromEnv } from "./secrets.mjs";
import { isStage } from "./stage.mjs";
import { periodEnd as endOfPeriod, promoDiscount, priceInvoice } from "./billing-money.mjs";
import { readJsonBody } from "./http-body.mjs";
import { fail, json, sessionFromRequest } from "./iam-http.mjs";
import { subscriptionLine } from "./pg/billing-change.mjs";

const CURRENCY = /^[A-Z]{3}$/;

async function memberOr404(store, request, response, orgId) {
  const session = await sessionFromRequest(request, store);
  if (!session) {
    fail(response, 401, "AUTH_REQUIRED", "sign in first");
    return null;
  }
  const membership = await store.getOrgMembership(orgId, session.user.id);
  if (!membership || membership.state !== "active") {
    fail(response, 404, "RESOURCE_NOT_AVAILABLE", "not found");
    return null;
  }
  return session;
}

async function adminOr403(store, orgId, userId, response) {
  if (await store.hasOrgRole(orgId, userId, "org_admin")) return true;
  fail(response, 403, "FORBIDDEN", "organisation administrator access required");
  return false;
}

/** `/billing/promo/check` — no session: the landing page quotes a code before sign-up. */
export async function checkPromo({ request, response, store }) {
  const body = await readJsonBody(request);
  if (!body?.code || !body?.priceId) {
    return fail(response, 422, "PROMO_INVALID", "code and priceId are required"), true;
  }
  if (typeof store.priceById !== "function") {
    return fail(response, 501, "BILLING_UNAVAILABLE", "billing needs the postgres store"), true;
  }
  const price = await store.priceById(String(body.priceId));
  if (!price) return fail(response, 404, "RESOURCE_NOT_AVAILABLE", "no such price"), true;
  const promo = await store.promoByCode(String(body.code));
  const result = promoDiscount({ promo, amount: price.amount });
  if (!result.ok) return fail(response, 422, result.code, "this code cannot be used here"), true;
  const totals = priceInvoice({ amount: price.amount, discount: result.discount });
  json(response, 200, {
    code: promo.code,
    currency: price.currency,
    discount: totals.discount,
    total: totals.total,
  });
  return true;
}

/**
 * Checkout for an organisation. A manual connection turns the request into an open
 * invoice and a pending payment; nothing is charged here, and no plan is granted until
 * the operator marks the invoice paid.
 */
async function checkout({ request, response, store, orgId, env = process.env }) {
  const session = await memberOr404(store, request, response, orgId);
  if (!session) return true;
  if (!(await adminOr403(store, orgId, session.user.id, response))) return true;

  const body = await readJsonBody(request);
  if (!body?.priceId || !body?.methodGroup) {
    return fail(response, 422, "BAD_CHECKOUT", "priceId and methodGroup are required"), true;
  }
  const consent = body.consent ?? {};
  // An invoice needs the terms, not autopay; a saved card needs both (§1 rule 8).
  if (!consent.termsVersion || typeof consent.autopay !== "boolean") {
    return fail(response, 422, "CONSENT_REQUIRED", "explicit consent is required"), true;
  }

  const price = await store.priceById(String(body.priceId));
  if (!price || price.status !== "for_sale" || price.promo_only) {
    return fail(response, 404, "RESOURCE_NOT_AVAILABLE", "this price is not for sale"), true;
  }
  const current = await store.liveSubscription(orgId);
  if (current && current.status !== "trialing" &&
    (current.plan !== price.plan || current.interval !== price.interval || current.pending_change)) {
    return fail(response, 409, "CHANGE_REQUIRED", "preview the plan change first"), true;
  }
  if (await store.pendingPlanPayment?.(orgId)) {
    return fail(response, 409, "OPERATION_IN_PROGRESS", "a change payment is pending"), true;
  }
  const currency = String(price.currency).toUpperCase();

  let account;
  try {
    account = await store.upsertBillingAccount({
      orgId,
      email: typeof body.billingEmail === "string" ? body.billingEmail : session.user.email,
      currency,
    });
  } catch (error) {
    if (error?.code === "CURRENCY_LOCKED") {
      return fail(response, 409, "CURRENCY_LOCKED", "this organisation pays in another currency"), true;
    }
    throw error;
  }

  const routes = await store.routesFor({
    methodGroup: String(body.methodGroup),
    currency,
    // On a stand every organisation pays through a test connection (ADR-280): live
    // connections are refused there, so a missing `test_mode` column cannot hide the
    // only payment the stand is allowed to take. Production keeps reading the account.
    testMode: isStage(env) || Boolean(account.test_mode),
  });
  const route = routes[0];
  if (!route) {
    return fail(response, 422, "NO_PAYMENT_ROUTE", "no connection serves this method"), true;
  }
  // The route list is public on purpose; the keys live only on the runtime read.
  const connection = (await store.connectionById?.(route.id)) ?? route;
  // A live connection on a stand is a misconfiguration, not a test payment (§5). The
  // refusal is recorded so the journal names the attempt instead of only the error.
  if (isStage(env) && connection.mode === "live") {
    await store.recordAudit?.({
      actorId: session.user.id,
      orgId,
      action: "billing.live_refused_on_stage",
      subject: connection.id,
      after: { mode: "live", currency, methodGroup: String(body.methodGroup) },
      reason: "live payment connections are disabled on a test stand",
    });
    return fail(
      response,
      409,
      "STAGE_LIVE_PAYMENT_REFUSED",
      "live payments are disabled on the test stand; use a test-mode connection",
    ), true;
  }
  const adapter = paymentAdapters()[connection.provider];
  if (!adapter) {
    return fail(response, 501, "PROVIDER_NOT_READY", "this provider arrives in a later stage"), true;
  }

  // A provider that talks to a network needs its sealed keys; a manual connection has no
  // envelope. The plaintext lives only for this request and goes to the adapter, never
  // into the response or the log.
  let usable = connection;
  if (connection.has_secret || connection.ciphertext) {
    let secret;
    try {
      secret = openConnectionSecret(connection, { kek: kekFromEnv() });
    } catch {
      return fail(response, 503, "PROVIDER_UNAVAILABLE", "the connection cannot be used"), true;
    }
    usable = { ...connection, secret };
  }

  // `bigint` columns arrive as strings from `pg`; money arithmetic is numeric here.
  const amount = Number(price.amount);
  let discount = 0;
  let promo = null;
  if (body.promoCode) {
    promo = await store.promoByCode(String(body.promoCode));
    const result = promoDiscount({ promo, amount });
    if (!result.ok) return fail(response, 422, result.code, "this code cannot be used here"), true;
    discount = result.discount;
  }
  const balance = Number(await store.creditBalance(orgId, currency));
  const totals = priceInvoice({ amount, discount, credit: balance });

  const periodStart = new Date();
  const periodEnd = endOfPeriod(periodStart, price.interval);
  // A reusable token needs the provider's capability and the payer's autopay consent.
  // The consent version is copied into the invoice line: the webhook that receives the
  // token has no session, and the invoice is the durable record of what was agreed.
  const savePaymentMethod = consent.autopay === true && adapter.capabilities?.saveMethod === true;
  const lines = [
    {
      kind: "subscription",
      plan: price.plan,
      interval: price.interval,
      priceId: price.id,
      amount,
      promoCode: promo?.code ?? null,
      ...(savePaymentMethod
        ? {
            autopayConsent: {
              version: String(consent.termsVersion),
              at: periodStart.toISOString(),
            },
          }
        : {}),
    },
  ];
  const invoice = await store.createInvoice({
    orgId,
    currency,
    lines,
    subtotal: totals.subtotal,
    discount: totals.discount,
    creditApplied: totals.creditApplied,
    total: totals.total,
    periodStart,
    periodEnd,
    dueAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });

  const payment = await store.recordPayment({
    orgId,
    invoiceId: invoice.invoice.id,
    connectionId: connection.id,
    providerPaymentId: null,
    idempotencyKey: `checkout:${invoice.invoice.id}`,
    amount: totals.total,
    currency,
    status: "pending",
  });

  return startPayment({ store, adapter, usable, body, invoice: invoice.invoice, payment, savePaymentMethod,
    email: account?.billing_email ?? session.user.email, plan: price.plan, response });
}

async function startPayment({ store, adapter, usable, body, invoice, payment, savePaymentMethod, email, plan, response }) {
  let returnUrl = body.returnUrl ?? null;
  if (returnUrl && subscriptionLine(invoice)?.planChange) {
    const url = new URL(returnUrl);
    url.searchParams.set("payment", payment.id);
    returnUrl = url.href;
  }
  let started;
  try {
    started = await adapter.createCheckout(usable, {
    paymentId: payment.id,
    idempotencyKey: payment.idempotency_key ?? `checkout:${invoice.id}`,
    amount: invoice.total,
    currency: invoice.currency,
    description: `${plan} plan`,
    savePaymentMethod,
    customerEmail: email,
    returnUrl,
      locale: body.locale === "en" ? "en" : "ru",
    });
  } catch (error) {
    if (!subscriptionLine(invoice)?.planChange) throw error;
    const failure = new Error("payment creation could not be confirmed", { cause: error });
    failure.code = "PAYMENT_UNCERTAIN";
    throw failure;
  }

  if (started.providerPaymentId) {
    await store.attachProviderPaymentId?.(payment.id, started.providerPaymentId);
  }

  json(response, 201, {
    invoiceId: invoice.id, paymentId: payment.id, amount: invoice.total, currency: invoice.currency,
    widget: started.widget ?? null, redirectUrl: started.redirectUrl ?? null,
  });
  return true;
}

const CHANGE_ERRORS = new Set(["QUOTE_EXPIRED", "CHANGE_UNAVAILABLE", "OPERATION_IN_PROGRESS", "CURRENCY_LOCKED"]);

async function changePlan({ request, response, store, orgId, env }) {
  const session = await memberOr404(store, request, response, orgId);
  if (!session || !(await adminOr403(store, orgId, session.user.id, response))) return true;
  try {
    if (request.method === "DELETE") {
      await store.cancelPlanChange(orgId, session.user.id);
      return json(response, 200, { ok: true }), true;
    }
    const body = await readJsonBody(request);
    const origin = env.REMO_APP_ORIGIN ?? request.headers.origin;
    if (origin) {
      const returnUrl = new URL("/org/billing", origin);
      returnUrl.searchParams.set("org", orgId);
      returnUrl.searchParams.set("billing", "return");
      if (body?.locale === "ru" || body?.locale === "en") returnUrl.searchParams.set("lang", body.locale);
      if (body) body.returnUrl = returnUrl.href;
    } else if (body) {
      delete body.returnUrl;
    }
    if (body?.invoiceId) return await payChangeInvoice({ request, response, store, orgId, env, session, body });
    if (typeof body?.priceId !== "string") return fail(response, 422, "BAD_CHECKOUT", "a target price is required"), true;
    const quote = await store.previewPlanChange(orgId, body.priceId);
    if (body.preview === true) {
      const account = await store.billingAccount(orgId);
      const routeFilter = { currency: quote.currency, testMode: isStage(env) || Boolean(account?.test_mode) };
      const groups = quote.type === "upgrade" ? await store.methodGroupsFor(routeFilter) : [];
      const autopayMethods = [];
      for (const methodGroup of groups) {
        const [route] = await store.routesFor({ ...routeFilter, methodGroup });
        if (route && paymentAdapters()[route.provider]?.capabilities?.saveMethod) autopayMethods.push(methodGroup);
      }
      return json(response, 200, { ...quote, autopayMethods }), true;
    }
    if (body.key !== quote.key) return fail(response, 409, "QUOTE_EXPIRED", "the calculation has changed"), true;

    const command = { orgId, priceId: body.priceId, key: body.key, actorId: session.user.id };
    if (quote.type === "downgrade") {
      const result = await store.confirmPlanChange(command);
      return json(response, 200, result), true;
    }
    if (!validChangeConsent(body)) return fail(response, 422, "CONSENT_REQUIRED", "explicit terms are required"), true;
    if (quote.total === 0) {
      const result = await store.confirmPlanChange(command);
      return json(response, 200, { applied: true, invoiceId: result.invoice.id }), true;
    }
    const context = await changePaymentContext({ store, orgId, env, response, session, body, currency: quote.currency });
    if (!context) return true;
    const { invoice, payment } = await store.confirmPlanChange({
      ...command, checkout: { connectionId: context.usable.id, autopay: context.autopay },
    });
    return startPayment({ ...context, body, store, invoice, payment, response, plan: quote.plan });
  } catch (error) {
    if (CHANGE_ERRORS.has(error?.code)) return fail(response, 409, error.code, error.message), true;
    if (error?.retryable || error?.code === "PAYMENT_UNCERTAIN") {
      return fail(response, 503, "PAYMENT_UNCERTAIN", "payment creation could not be confirmed"), true;
    }
    throw error;
  }
}

function validChangeConsent(body) {
  return typeof body.consent?.termsVersion === "string" && Boolean(body.consent.termsVersion.trim())
    && typeof body.consent.autopay === "boolean";
}

async function changePaymentContext({ store, orgId, env, response, session, body, currency }) {
  const account = await store.billingAccount(orgId);
  const routes = await store.routesFor({
    methodGroup: String(body.methodGroup ?? ""), currency, testMode: isStage(env) || Boolean(account?.test_mode),
  });
  const route = routes[0];
  const connection = route && await store.connectionById(route.id);
  const adapter = connection && paymentAdapters()[connection.provider];
  if (!adapter || (isStage(env) && connection.mode === "live")) {
    fail(response, 422, "NO_PAYMENT_ROUTE", "no connection serves this method");
    return null;
  }
  const usable = connection.has_secret || connection.ciphertext
    ? { ...connection, secret: openConnectionSecret(connection, { kek: kekFromEnv() }) }
    : connection;
  const savePaymentMethod = body.consent.autopay && adapter.capabilities?.saveMethod === true;
  return {
    adapter, usable, savePaymentMethod, email: account?.billing_email ?? session.user.email,
    autopay: savePaymentMethod ? { autopayConsent: {
      version: body.consent.termsVersion, at: new Date().toISOString(),
    } } : {},
  };
}

async function payChangeInvoice({ response, store, orgId, env, session, body }) {
  if (!validChangeConsent(body)) return fail(response, 422, "CONSENT_REQUIRED", "explicit terms are required"), true;
  const invoice = await store.invoiceById(orgId, body.invoiceId);
  if (!invoice || subscriptionLine(invoice)?.planChange?.type !== "downgrade") {
    return fail(response, 404, "RESOURCE_NOT_AVAILABLE", "no such renewal invoice"), true;
  }
  const context = await changePaymentContext({ store, orgId, env, response, session, body, currency: invoice.currency });
  if (!context) return true;
  const payment = await store.openChangePayment(orgId, invoice.id, context.usable.id);
  return startPayment({ ...context, savePaymentMethod: false, body, store, invoice, payment, response,
    plan: subscriptionLine(invoice).plan });
}

/** Checkout status after a return to the app; nothing here trusts the browser. */
async function checkoutStatus({ request, response, store, orgId, paymentId }) {
  const session = await memberOr404(store, request, response, orgId);
  if (!session) return true;
  if (!(await adminOr403(store, orgId, session.user.id, response))) return true;
  const payment = await store.billingPayment(orgId, paymentId);
  if (!payment) return fail(response, 404, "RESOURCE_NOT_AVAILABLE", "no such payment"), true;
  const invoice = await store.invoiceById(orgId, payment.invoice_id);
  const line = subscriptionLine(invoice);
  const change = line?.planChange;
  const paid = change && invoice.status === "paid";
  json(response, 200, {
    ...(change ? { plan: line.plan, invoiceNumber: invoice.number,
      applied: Boolean(paid && await store.planChangeApplied(orgId, invoice.id))
    } : {}),
    paymentId: payment.id,
    invoiceId: payment.invoice_id,
    status: paid ? "succeeded" : payment.status,
    amount: payment.amount,
    currency: payment.currency,
  });
  return true;
}

async function invoices({ request, response, store, orgId }) {
  const session = await memberOr404(store, request, response, orgId);
  if (!session) return true;
  if (!(await adminOr403(store, orgId, session.user.id, response))) return true;
  json(response, 200, { invoices: await store.listInvoices(orgId, 50) });
  return true;
}

/** Routes under `/orgs/:id/billing/…`; the caller has already resolved the organisation. */
export async function handleCheckoutRoutes({ request, response, url, store, orgId, rest, env = process.env }) {
  const method = request.method ?? "GET";
  const [head, tail] = rest.split("/");

  if (head === "change" && !tail) {
    if (method !== "POST" && method !== "DELETE") return fail(response, 405, "METHOD_NOT_ALLOWED", "use POST or DELETE"), true;
    return changePlan({ request, response, store, orgId, env });
  }
  if (head === "checkout" && !tail) {
    if (method !== "POST") return fail(response, 405, "METHOD_NOT_ALLOWED", "use POST"), true;
    return checkout({ request, response, store, orgId, env });
  }
  if (head === "checkout" && tail) {
    if (method !== "GET") return fail(response, 405, "METHOD_NOT_ALLOWED", "use GET"), true;
    return checkoutStatus({ request, response, store, orgId, paymentId: tail });
  }
  if (head === "invoices" && !tail) {
    if (method !== "GET") return fail(response, 405, "METHOD_NOT_ALLOWED", "use GET"), true;
    return invoices({ request, response, store, orgId });
  }
  return false;
}
