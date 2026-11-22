/**
 * The console's changing actions (ADR-262 §3, `spec/operator-actions.md` §3).
 *
 * Every route is the same act as a shell command: the refund route calls `refundPayment`,
 * the plan route `grantPlan`, the complaint routes `applyMeasure`/`revertMeasure`. This
 * module owns only the HTTP shape — the role and step-up are checked by
 * `operator-console-api.mjs` before it is reached.
 *
 * A form sends `requestId`; `operator_requests` makes the first answer the only one. A
 * failed action releases its claim, so correcting a form and pressing again works.
 */
import { fail, json, readBody } from "./iam-http.mjs";
import {
  grantCredit,
  refundPayment,
} from "./operator-billing.mjs";
import { grantPlan, parseUntil } from "./operator-billing-grant.mjs";
import { markInvoicePaid } from "./operator-billing-paid.mjs";
import { applyMeasure, revertMeasure } from "./operator-abuse.mjs";
import { PLAN_NAMES } from "./billing-catalog.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CURRENCY = /^[A-Z]{3}$/;
const REASON_MIN = 10;
const MEASURE_KINDS = new Set(["link_disable", "board_hide", "org_suspend"]);

/** Which `/operator/...` POST belongs to which act. Everything else is a 404. */
export function matchOperatorAction(path, method = "POST") {
  if (method !== "POST") return null;
  if (path === "/operator/measures") return { kind: "measure", path };
  const revert = /^\/operator\/measures\/([^/]+)\/revert$/.exec(path);
  if (revert) return { kind: "revert", id: decodeURIComponent(revert[1]), path };
  const refund = /^\/operator\/payments\/([^/]+)\/refund$/.exec(path);
  if (refund) return { kind: "refund", id: decodeURIComponent(refund[1]), path };
  const paid = /^\/operator\/invoices\/([^/]+)\/mark-paid$/.exec(path);
  if (paid) return { kind: "markPaid", id: decodeURIComponent(paid[1]), path };
  const credit = /^\/operator\/orgs\/([^/]+)\/credit$/.exec(path);
  if (credit) return { kind: "credit", id: decodeURIComponent(credit[1]), path };
  const grant = /^\/operator\/orgs\/([^/]+)\/grant$/.exec(path);
  if (grant) return { kind: "grant", id: decodeURIComponent(grant[1]), path };
  return null;
}

function codedError(code, message, status = 400, details = null) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.details = details;
  return error;
}

function uuid(value, name) {
  const text = String(value ?? "").trim();
  if (!UUID.test(text)) throw codedError("BAD_ID", `${name} must be a uuid`);
  return text;
}

function requiredReason(body) {
  const reason = String(body?.reason ?? "").trim();
  if (reason.length < REASON_MIN) {
    throw codedError(
      "REASON_REQUIRED",
      `a reason of at least ${REASON_MIN} characters is required`,
    );
  }
  return reason;
}

function requiredRequestId(body) {
  return uuid(body?.requestId, "requestId");
}

function positiveMinorUnits(raw, name) {
  const text = String(raw ?? "").trim();
  if (!/^\d+$/.test(text) || Number(text) <= 0) {
    throw codedError("BAD_AMOUNT", `${name} must be a whole number of minor units`);
  }
  return Number(text);
}

function zeroableMinorUnits(raw, name) {
  const text = String(raw ?? "").trim();
  if (!/^\d+$/.test(text)) {
    throw codedError("BAD_AMOUNT", `${name} must be a whole number of minor units`);
  }
  return Number(text);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run an act once per `requestId`. A concurrent duplicate waits briefly for the first
 * answer; a repeat afterwards receives it unchanged (`spec/operator-actions.md` §3.3).
 */
async function once({ store, requestId, operatorId, route, run }) {
  let claim = await store.claimOperatorRequest({ requestId, operatorId, route });
  if (claim.state === "conflict") {
    throw codedError(
      "REQUEST_CONFLICT",
      "this requestId belongs to another operator or another action",
      409,
    );
  }
  if (claim.state === "busy") {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await sleep(100);
      claim = await store.claimOperatorRequest({ requestId, operatorId, route });
      if (claim.state === "done") return claim.result;
      if (claim.state === "conflict") {
        throw codedError(
          "REQUEST_CONFLICT",
          "this requestId belongs to another operator or another action",
          409,
        );
      }
    }
    throw codedError(
      "REQUEST_IN_PROGRESS",
      "the same action is still running; wait for its answer",
      409,
    );
  }
  if (claim.state === "done") return claim.result;
  try {
    const result = await run();
    await store.completeOperatorRequest({ requestId, result });
    return result;
  } catch (error) {
    await store.releaseOperatorRequest({ requestId }).catch(() => null);
    throw error;
  }
}

const STATUS = {
  PAYMENT_NOT_FOUND: 404,
  INVOICE_NOT_FOUND: 404,
  ORG_NOT_FOUND: 404,
  ROOM_NOT_FOUND: 404,
  ACTION_NOT_FOUND: 404,
  SUBJECT_GONE: 404,
  REQUEST_CONFLICT: 409,
  REQUEST_IN_PROGRESS: 409,
  REFUND_STATE_CHANGED: 409,
  PAYMENT_NOT_REFUNDABLE: 409,
  PAYMENT_FULLY_REFUNDED: 409,
  AMOUNT_TOO_HIGH: 409,
  INVOICE_VOID: 409,
  LINK_NOT_ENABLED: 409,
  PRICE_MISSING: 409,
  PRICE_NOT_FOUND: 409,
  PRICE_NOT_FOR_SALE: 409,
  PRICE_PLAN_MISMATCH: 409,
  PRICE_CURRENCY_MISMATCH: 409,
  PRICE_PROMO_ONLY: 409,
  MAIL_UNAVAILABLE: 503,
  PROVIDER_UNAVAILABLE: 503,
  NO_APPEAL_ADDRESS: 503,
  PROVIDER_REFUSED: 502,
  MEASURE_LETTER_FAILED: 502,
};

function errorResponse(response, error) {
  const status = error.status ?? STATUS[error.code] ?? 500;
  const payload = {
    error: error.code ?? "OPERATOR_ACTION_FAILED",
    message: error.message ?? "the action failed",
  };
  if (error.details && typeof error.details === "object") Object.assign(payload, error.details);
  json(response, status, payload);
}

/**
 * @returns {Promise<boolean>} true when the request was one of the action routes.
 */
export async function handleOperatorAction({
  request,
  response,
  store,
  session,
  action,
  env = process.env,
  mailConfig = null,
  log = console,
} = {}) {
  const body = await readBody(request);
  if (body === null) {
    fail(response, 400, "BAD_JSON", "malformed request");
    return true;
  }
  const operatorId = session.user.id;
  const actor = { id: session.user.id, email: session.user.email };
  const channel = "console";
  const mfa = session.mfaFactor ?? null;

  try {
    const reason = requiredReason(body);
    const requestId = requiredRequestId(body);

    const result = await once({
      store,
      requestId,
      operatorId,
      route: action.path,
      run: async () => {
        if (action.kind === "refund") {
          const paymentId = uuid(action.id, "paymentId");
          const expectRefunded = zeroableMinorUnits(body.expectRefunded, "expectRefunded");
          const amount =
            body.amount === undefined || body.amount === null || body.amount === ""
              ? null
              : positiveMinorUnits(body.amount, "amount");
          return refundPayment({
            store,
            paymentId,
            amount,
            expectRefunded,
            reason,
            actor,
            channel,
            mfa,
            requestId,
            env,
            mailConfig,
          });
        }
        if (action.kind === "markPaid") {
          const invoiceId = uuid(action.id, "invoiceId");
          const ref = String(body.ref ?? "").trim() || null;
          const paid = await markInvoicePaid({
            store,
            invoiceId,
            reason,
            ref,
            actor,
            channel,
            mfa,
          });
          return {
            alreadyPaid: paid.alreadyPaid,
            invoice: {
              id: paid.invoice.id,
              number: paid.invoice.number,
              status: paid.alreadyPaid ? paid.invoice.status : "paid",
            },
            plan: paid.settled?.subscription?.plan ?? null,
          };
        }
        if (action.kind === "credit") {
          const orgId = uuid(action.id, "orgId");
          const amount = positiveMinorUnits(body.amount, "amount");
          const currency = body.currency
            ? String(body.currency).trim().toUpperCase()
            : null;
          if (currency !== null && !CURRENCY.test(currency)) {
            throw codedError("BAD_CURRENCY", "currency must be an ISO 4217 code");
          }
          const credit = await grantCredit({
            store,
            orgId,
            amount,
            currency,
            reason,
            actor,
            channel,
            mfa,
            env,
          });
          return {
            ledgerId: credit.credit.id,
            orgId,
            amount,
            currency: credit.currency,
          };
        }
        if (action.kind === "grant") {
          const orgId = uuid(action.id, "orgId");
          const plan = String(body.plan ?? "").trim();
          if (!PLAN_NAMES.includes(plan) || plan === "free") {
            throw codedError("BAD_PLAN", "plan must be a paid plan");
          }
          const until = parseUntil(body.until);
          const currency = body.currency
            ? String(body.currency).trim().toUpperCase()
            : null;
          if (currency !== null && !CURRENCY.test(currency)) {
            throw codedError("BAD_CURRENCY", "currency must be an ISO 4217 code");
          }
          const granted = await grantPlan({
            store,
            orgId,
            plan,
            until,
            currency,
            reason,
            actor,
            channel,
            mfa,
            env,
          });
          return {
            plan: granted.plan,
            until: granted.until?.toISOString() ?? null,
            priceId: granted.price?.id ?? null,
            amount: granted.price?.amount ?? null,
            currency: granted.price?.currency ?? null,
            interval: granted.price?.interval ?? null,
          };
        }
        if (action.kind === "measure") {
          const kind = String(body.kind ?? "").trim();
          if (!MEASURE_KINDS.has(kind)) throw codedError("BAD_KIND", "unknown measure kind");
          const target = String(body.target ?? "").trim();
          if (!target) throw codedError("BAD_ID", "target is required");
          // A room id is text in the schema; an organisation id is a uuid. A pasted room
          // link is shortened to its id by the form before it is sent.
          if (kind === "org_suspend" && !UUID.test(target)) {
            throw codedError("BAD_ID", "an organisation target must be a uuid");
          }
          const subjectType =
            kind === "org_suspend" ? "org" : kind === "board_hide" ? "board" : "board_link";
          const applied = await applyMeasure({
            store,
            kind,
            subjectType,
            subjectId: target,
            reason,
            // The console has one reason field: the operator sees that the client reads it
            // in the confirmation, so the public explanation is the same text.
            publicReason: reason,
            reportRef: String(body.reportRef ?? "").trim() || null,
            actor,
            channel,
            mfa,
            env,
            mailConfig,
          });
          return { action: applied.action, created: applied.created };
        }
        if (action.kind === "revert") {
          const reverted = await revertMeasure({
            store,
            actionId: uuid(action.id, "actionId"),
            reason,
            actor,
            channel,
            mfa,
            env,
            mailConfig,
          });
          return {
            action: reverted.action,
            changed: reverted.changed,
            mailed: reverted.mailed,
          };
        }
        throw codedError("UNKNOWN_ACTION", "unknown operator action", 404);
      },
    });

    json(response, 200, { ok: true, result });
    return true;
  } catch (error) {
    if (!error.status && !error.code) log.error?.("[operator] action failed:", error?.message);
    errorResponse(response, error);
    return true;
  }
}

/** The route list is part of the contract: `operator:*` and `mfa:reset` have no entry. */
export const OPERATOR_ACTION_ROUTES = Object.freeze([
  "POST /operator/payments/<id>/refund",
  "POST /operator/invoices/<id>/mark-paid",
  "POST /operator/orgs/<id>/credit",
  "POST /operator/orgs/<id>/grant",
  "POST /operator/measures",
  "POST /operator/measures/<id>/revert",
]);

