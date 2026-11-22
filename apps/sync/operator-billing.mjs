/**
 * `billing:refund` and `billing:credit` (ADR-259, `spec/operator.md` §3, `spec/billing.md`
 * §4.3, §4.4), and the actions behind the console's money forms (ADR-262 §3).
 *
 * A refund is a provider act and a ledger row, in that order: the command first proves it
 * may (a succeeded payment, an amount within what is left, a reason, a reachable payer and
 * mail that can send the letter), then asks the connection's adapter, then appends the row
 * the whole billing module reads. A full refund of the current period ends the subscription
 * at once; every path writes an audit row.
 *
 * Credit is the other direction: a signed ledger entry of kind `goodwill`, applied to the
 * next invoice by the existing billing machinery. It never touches a payment.
 *
 * `refundPayment` and `grantCredit` are the act, not the command line: the shell and the
 * console call the same function and differ only in how the inputs arrive and the result
 * is printed (`spec/operator-actions.md` §3.1 rule 4).
 */
import { assertMinorUnits } from "./billing-money.mjs";
import { assertMailConfig, enqueueMail, resolveMailConfig } from "./mail.mjs";
import { openConnectionSecret } from "./payment-connections.mjs";
import { paymentAdapters } from "./payment-adapters.mjs";
import { operatorAudit } from "./operator-audit.mjs";
import { assertOperatorCliMfa } from "./operator-cli-mfa.mjs";
import {
  requireOperatorActor,
  requireOperatorActorValue,
} from "./operator-role.mjs";
import { PostgresStore } from "./postgres.mjs";
import { kekFromEnv } from "./secrets.mjs";

export { GRANT_USAGE, parseGrantArgs, parseUntil, runBillingGrant } from "./operator-billing-grant.mjs";
export {
  MARK_PAID_USAGE,
  parseMarkPaidArgs,
  runBillingMarkPaid,
} from "./operator-billing-paid.mjs";

export const REFUND_USAGE = `usage:
  pnpm billing:refund <payment-id> --expect-refunded <minor-units> [--amount <minor-units>]
                      --reason "..." --as <operator> [--code <six digits>]

  <payment-id>      our payment id (uuid).
  --expect-refunded what you believe is already returned on this payment, in minor units.
                    Required. Read it from \`customer:show\` next to the payment
                    ("refunded 0.00 RUB") and type it exactly: a mismatch refuses the
                    command before the provider is called.
  --amount          how much to return, in minor units. Without it, the whole remaining sum.
  --reason          why the money goes back; stored in the refund and the audit row. Required.
  --as              the operator performing the command, an id or an address. Required;
                    REMO_OPERATOR is the fallback.
  --code            the operator's six-digit second-factor code (or a recovery code). Asked
                    interactively in a terminal; required otherwise.
  --request-id      optional uuid of a console form; a repeat with the same id is the same
                    refund. The console always sends one.

The refunded sum is checked inside the transaction that locks the payment; a repeated
command after a successful refund refuses with exit code 3 and never reaches the provider.
A full refund of the current period cancels the subscription at once. The payer receives
the letter; the bank's own delay is not ours to promise.`;

export const CREDIT_USAGE = `usage:
  pnpm billing:credit --org <organisation-id> --amount <minor-units> --reason "..."
                      [--currency <ISO>] --as <operator> [--code <six digits>]

  --amount      a positive amount in minor units, added to the organisation's credit.
  --currency    defaults to the organisation's billing currency, then the installation's.
  --reason      why the credit is given; stored in the audit row. Required.
  --as          the operator performing the command, an id or an address. Required;
                REMO_OPERATOR is the fallback.
  --code        the operator's six-digit second-factor code (or a recovery code). Asked
                interactively in a terminal; required otherwise.`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CURRENCY = /^[A-Z]{3}$/;

/** A refusal the route turns into a status code and the CLI into a line and exit code. */
export function codedError(code, message, details = null) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function readFlags(args) {
  const flags = new Map();
  const positionals = [];
  for (let index = 0; index < args.length; index += 1) {
    const item = args[index];
    if (!item.startsWith("--")) {
      positionals.push(item);
      continue;
    }
    const name = item.slice(2);
    if (name === "help") {
      flags.set(name, true);
      continue;
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`--${name} needs a value`);
    flags.set(name, value);
    index += 1;
  }
  return { flags, positionals };
}

function minorUnits(raw, name = "--amount") {
  const text = String(raw ?? "").trim();
  if (!/^\d+$/.test(text)) throw new Error(`${name} must be a whole number of minor units`);
  const value = Number(text);
  assertMinorUnits(value, name);
  if (value === 0) throw new Error(`${name} must be greater than zero`);
  return value;
}

/** `--expect-refunded` may be zero: "nothing has been returned yet" is the usual answer. */
function zeroableMinorUnits(raw, name) {
  const text = String(raw ?? "").trim();
  if (!/^\d+$/.test(text)) throw new Error(`${name} must be a whole number of minor units`);
  const value = Number(text);
  assertMinorUnits(value, name);
  return value;
}

export function parseRefundArgs(argv) {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    return { help: true };
  }
  const { flags, positionals } = readFlags(argv);
  for (const name of flags.keys()) {
    if (!["amount", "reason", "as", "expect-refunded", "code", "request-id"].includes(name)) {
      throw new Error(`billing:refund does not take --${name}`);
    }
  }
  if (positionals.length !== 1) throw new Error("the payment id is required");
  const paymentId = positionals[0].trim();
  if (!UUID.test(paymentId)) throw new Error("the payment id must be a uuid");
  const reason = String(flags.get("reason") ?? "").trim();
  if (!reason) throw new Error("--reason is required: a refund without a reason is refused");
  if (!flags.has("expect-refunded")) {
    throw new Error(
      "--expect-refunded is required: type what customer:show says is already returned, or the command refuses to guess",
    );
  }
  const expectRefunded = zeroableMinorUnits(flags.get("expect-refunded"), "--expect-refunded");
  const amount = flags.has("amount") ? minorUnits(flags.get("amount")) : null;
  const as = flags.has("as") ? String(flags.get("as")).trim() : null;
  if (as === "") throw new Error("--as needs an operator id or email address");
  const code = flags.has("code") ? String(flags.get("code")).trim() : null;
  if (code === "") throw new Error("--code needs the six-digit code from the app");
  const requestId = flags.has("request-id") ? String(flags.get("request-id")).trim() : null;
  if (requestId !== null && !UUID.test(requestId)) throw new Error("--request-id must be a uuid");
  return { help: false, paymentId, amount, reason, as, expectRefunded, code, requestId };
}

export function parseCreditArgs(argv) {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    return { help: true };
  }
  const { flags, positionals } = readFlags(argv);
  if (positionals.length > 0) throw new Error(`unexpected argument ${positionals[0]}`);
  for (const name of flags.keys()) {
    if (!["org", "amount", "reason", "currency", "as", "code", "request-id"].includes(name)) {
      throw new Error(`billing:credit does not take --${name}`);
    }
  }
  const orgId = String(flags.get("org") ?? "").trim();
  if (!UUID.test(orgId)) throw new Error("--org <organisation id> is required and must be a uuid");
  if (!flags.has("amount")) throw new Error("--amount is required");
  const amount = minorUnits(flags.get("amount"));
  const reason = String(flags.get("reason") ?? "").trim();
  if (!reason) throw new Error("--reason is required: a credit without a reason is refused");
  const currency = flags.has("currency")
    ? String(flags.get("currency")).trim().toUpperCase()
    : null;
  if (currency !== null && !CURRENCY.test(currency)) {
    throw new Error("--currency must be an ISO 4217 code");
  }
  const as = flags.has("as") ? String(flags.get("as")).trim() : null;
  if (as === "") throw new Error("--as needs an operator id or email address");
  const code = flags.has("code") ? String(flags.get("code")).trim() : null;
  if (code === "") throw new Error("--code needs the six-digit code from the app");
  const requestId = flags.has("request-id") ? String(flags.get("request-id")).trim() : null;
  if (requestId !== null && !UUID.test(requestId)) throw new Error("--request-id must be a uuid");
  return { help: false, orgId, amount, reason, currency, as, code, requestId };
}

function openStore(env) {
  const connectionString = env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required: billing lives in Postgres");
  return new PostgresStore({
    connectionString,
    migrationConnectionString: env.REMO_MIGRATION_DATABASE_URL ?? connectionString,
    log: console,
  });
}

/** The installation's first currency when the organisation has no billing book yet. */
export function defaultCurrency(env = process.env) {
  const first = String(env.REMO_BILLING_CURRENCIES ?? "")
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .find((value) => CURRENCY.test(value));
  return first ?? "RUB";
}

function displayMoney(amount, currency) {
  const value = Number(amount);
  if (!Number.isFinite(value)) return `${amount} ${currency}`;
  return `${Math.floor(value / 100)}.${String(value % 100).padStart(2, "0")} ${currency}`;
}

/** The payer's address and language; the letter is the refund's other half. */
async function refundRecipient(store, orgId) {
  const { rows } = await store.withTenant(orgId, () =>
    store.pool.query(
      `select billing_email, currency from billing_accounts where org_id = $1`,
      [orgId],
    ),
  );
  const admins = await store.operatorOrgAdmins(orgId);
  return {
    email: rows[0]?.billing_email ?? admins[0]?.email ?? null,
    locale: admins[0]?.lang === "en" ? "en" : "ru",
  };
}

/**
 * Record the refund in the tenant, cancel a current-period subscription on a full refund,
 * and write the audit row. The row is appended only after the provider agreed.
 */
async function recordOperatorRefund({
  store,
  payment,
  amount,
  reason,
  status,
  providerRefundId,
  idempotencyKey,
  actorId,
  full,
  expectRefunded = null,
  channel = "cli",
  mfa = null,
}) {
  return store.withTenant(payment.org_id, async () => {
    const refund = await store.recordRefund({
      orgId: payment.org_id,
      paymentId: payment.id,
      amount,
      currency: payment.currency,
      reason,
      status,
      providerRefundId,
      idempotencyKey,
      createdBy: actorId,
      expectRefunded,
    });
    if (full && status === "succeeded" && payment.subscription_id) {
      const end = payment.period_end ? new Date(payment.period_end).getTime() : 0;
      if (end >= Date.now()) {
        await store.cancelSubscription(payment.subscription_id).catch(() => null);
      }
    }
    await store.recordAudit(
      operatorAudit({
        channel,
        mfa,
        actorId,
        orgId: payment.org_id,
        action: "billing.refunded",
        subject: payment.id,
        after: {
          amount,
          currency: payment.currency,
          full,
          refundId: refund.id,
          providerRefundId: providerRefundId ?? null,
          expectedRefunded: expectRefunded,
        },
        reason,
      }),
    );
    // After a successful provider answer the money has moved: a sum that changed under
    // the command is a warning and its own row, never a refusal of the refund that
    // happened (`spec/operator-actions.md` §1.1).
    if (refund.concurrent) {
      refund.concurrent.others = await store.operatorRefundAuthors({
        paymentId: payment.id,
        excludeUserId: actorId ?? null,
      });
      await store.recordAudit(
        operatorAudit({
          channel,
          mfa,
          actorId,
          orgId: payment.org_id,
          action: "refund.concurrent",
          subject: payment.id,
          before: { refunded: refund.concurrent.expected },
          after: {
            refunded: refund.concurrent.actual,
            refundId: refund.id,
            amount,
            others: refund.concurrent.others,
          },
          reason,
        }),
      );
    }
    return refund;
  });
}
/**
 * Return money, once, and say what happened. The one implementation behind
 * `pnpm billing:refund` and the console's refund form (`spec/operator-actions.md` §1–§3).
 *
 * @throws an error with a `code` (`PAYMENT_NOT_FOUND`, `REFUND_STATE_CHANGED`,
 *   `PAYMENT_FULLY_REFUNDED`, `AMOUNT_TOO_HIGH`, `NO_BILLING_ADDRESS`, `MAIL_UNAVAILABLE`,
 *   `PROVIDER_UNAVAILABLE`) that both callers translate.
 */
export async function refundPayment({
  store,
  paymentId,
  amount = null,
  expectRefunded,
  reason,
  actor,
  channel = "cli",
  mfa = null,
  requestId = null,
  env = process.env,
  fetchImpl = undefined,
  adapters = null,
  kek = undefined,
  mailConfig = null,
}) {
  const payment = await store.operatorPayment(paymentId);
  if (!payment) throw codedError("PAYMENT_NOT_FOUND", `no payment ${paymentId}`);
  if (!["succeeded", "partially_refunded"].includes(payment.status)) {
    throw codedError(
      "PAYMENT_NOT_REFUNDABLE",
      `payment ${payment.id} is ${payment.status}; only a paid payment can be refunded`,
    );
  }

  // The operator's claim is checked under the payment's row lock before anything else
  // happens: a repeated command after a successful refund must stop here, not reach the
  // provider (`spec/operator-actions.md` §1.1).
  const state = await store.operatorRefundState({ paymentId: payment.id });
  if (!state) throw codedError("PAYMENT_NOT_FOUND", `no payment ${payment.id}`);
  if (state.refunded !== expectRefunded) {
    throw codedError(
      "REFUND_STATE_CHANGED",
      `${payment.id}: already refunded ${displayMoney(state.refunded, payment.currency)}, expected ` +
        `${displayMoney(expectRefunded, payment.currency)}`,
      {
        refunded: state.refunded,
        expected: expectRefunded,
        currency: payment.currency,
      },
    );
  }
  const remaining = payment.amount - state.refunded;
  if (remaining <= 0) {
    throw codedError("PAYMENT_FULLY_REFUNDED", `payment ${payment.id} is already fully refunded`);
  }
  const sum = amount ?? remaining;
  if (sum > remaining) {
    throw codedError(
      "AMOUNT_TOO_HIGH",
      `${sum} is more than the ${remaining} still refundable on ${payment.id}`,
      { amount: sum, remaining, currency: payment.currency },
    );
  }
  const full = state.refunded + sum >= payment.amount;

  // The letter must have somewhere to go before the money moves. A refund that cannot
  // tell the payer is not the act the offer describes.
  let config;
  try {
    config = mailConfig ?? assertMailConfig(resolveMailConfig(env), { env });
  } catch (error) {
    throw codedError(
      "MAIL_UNAVAILABLE",
      `mail is not configured: ${error.message ?? error}`,
    );
  }
  if (config.driver === "disabled") {
    throw codedError(
      "MAIL_UNAVAILABLE",
      "mail is disabled; the refund letter cannot be sent, so nothing was refunded",
    );
  }
  const recipient = await refundRecipient(store, payment.org_id);
  if (!recipient.email) {
    throw codedError(
      "NO_BILLING_ADDRESS",
      `organisation ${payment.org_id} has no billing address; nothing was refunded`,
    );
  }

  // The connection is global; a manual payment has no provider API, so the ledger row is
  // the whole act. A payment whose connection is gone cannot be returned through the
  // provider, and recording a refund that never happened would be a lie.
  const connection = payment.connection_id
    ? await store.connectionById(payment.connection_id)
    : null;
  if (!connection) {
    throw codedError(
      "PROVIDER_UNAVAILABLE",
      `payment ${payment.id}: its connection no longer exists; nothing was refunded`,
    );
  }
  const adapter = (adapters ?? paymentAdapters(env))[connection.provider];
  if (!adapter) {
    throw codedError(
      "PROVIDER_UNAVAILABLE",
      `payment ${payment.id}: provider ${connection.provider} is not available`,
    );
  }
  const needsProvider = adapter.capabilities?.refunds !== "none";
  let providerStatus = "succeeded";
  let providerRefundId = null;
  // The console's key is the form (`spec/operator-actions.md` §1.2); the shell keeps the
  // expectation in it, so a technical retry is the same provider request.
  const idempotencyKey = requestId
    ? `operator-refund:${payment.id}:console:${requestId}`
    : `operator-refund:${payment.id}:${expectRefunded}:${sum}`;

  const already = await store.withOwnerClient(async (client) => {
    const { rows } = await client.query(
      "select * from refunds where idempotency_key = $1",
      [idempotencyKey],
    );
    return rows[0] ?? null;
  });
  if (already) {
    return {
      already: true,
      paymentId: payment.id,
      refundId: already.id,
      amount: Number(already.amount),
      currency: already.currency,
      status: already.status,
      full,
      mailed: false,
    };
  }

  if (needsProvider) {
    if (!payment.provider_payment_id) {
      throw codedError(
        "PROVIDER_UNAVAILABLE",
        `payment ${payment.id} has no provider id; the provider cannot refund it`,
      );
    }
    if (!adapter.refund) {
      throw codedError("PROVIDER_UNAVAILABLE", `${connection.provider} does not support refunds`);
    }
    let usable = connection;
    if (connection.has_secret || connection.ciphertext) {
      try {
        usable = {
          ...connection,
          secret: openConnectionSecret(connection, { kek: kek ?? kekFromEnv(env) }),
        };
      } catch (error) {
        throw codedError(
          "PROVIDER_UNAVAILABLE",
          `the connection secret is unreadable (${error.code ?? "error"})`,
        );
      }
    }
    let result;
    try {
      result = await adapter.refund(
        usable,
        {
          providerPaymentId: payment.provider_payment_id,
          amount: sum,
          currency: payment.currency,
          idempotencyKey,
        },
        { fetchImpl },
      );
    } catch (error) {
      throw codedError(
        "PROVIDER_REFUSED",
        `${connection.provider} refused the refund: ${error.message ?? error}`,
      );
    }
    providerStatus = result?.status === "pending" ? "pending" : "succeeded";
    providerRefundId = result?.providerRefundId ?? null;
  }

  const refund = await recordOperatorRefund({
    store,
    payment,
    amount: sum,
    reason,
    status: providerStatus,
    providerRefundId,
    idempotencyKey,
    actorId: actor?.id ?? null,
    full,
    expectRefunded,
    channel,
    mfa,
  });

  let mailed = false;
  try {
    await enqueueMail(
      store,
      {
        userId: null,
        toEmail: recipient.email,
        template: "payment_refunded",
        locale: recipient.locale,
        params: {
          amount: displayMoney(sum, payment.currency),
          currency: payment.currency,
          invoice: payment.invoice_number,
          reason,
          billingUrl: `${config.appOrigin}/?billing=1`,
        },
      },
      { config },
    );
    mailed = true;
  } catch {
    // The money moved, so the ledger row stays; the caller tells the operator to send the
    // letter by hand from the journal.
    mailed = false;
  }

  return {
    already: false,
    paymentId: payment.id,
    orgId: payment.org_id,
    invoiceNumber: payment.invoice_number,
    refundId: refund.id,
    amount: sum,
    currency: payment.currency,
    status: providerStatus,
    full,
    mailed,
    recipient: recipient.email,
    concurrent: refund.concurrent
      ? { ...refund.concurrent, others: refund.concurrent.others ?? [] }
      : null,
  };
}

export async function runBillingRefund({
  argv,
  env = process.env,
  store = null,
  out = console.log,
  err = console.error,
  fetchImpl = undefined,
  adapters = null,
  kek = undefined,
  mailConfig = null,
  stdin = process.stdin,
  stdout = process.stderr,
  ask = undefined,
} = {}) {
  let args;
  try {
    args = parseRefundArgs(argv);
  } catch (error) {
    err(`[billing:refund] ${error.message}`);
    err(REFUND_USAGE);
    return 1;
  }
  if (args.help) {
    out(REFUND_USAGE);
    return 0;
  }

  // The author is required before the payment is even read: a refund without an author
  // is the unattributable act the amendment closed.
  try {
    requireOperatorActorValue(args.as, env);
  } catch (error) {
    err(`[billing:refund] ${error.message}`);
    err(REFUND_USAGE);
    return 1;
  }

  let opened = null;
  try {
    const active = store ?? (opened = openStore(env));
    if (!store) await active.connect();
    const actor = await requireOperatorActor(active, args.as, { env });

    // Money moves only after the acting operator proved the second factor (ADR-262 §5).
    let proof;
    try {
      proof = await assertOperatorCliMfa({
        store: active,
        actor,
        code: args.code,
        env,
        kek,
        stdin,
        stdout,
        ask,
      });
    } catch (error) {
      err(`[billing:refund] ${error.message ?? error}`);
      return 1;
    }

    const result = await refundPayment({
      store: active,
      paymentId: args.paymentId,
      amount: args.amount,
      expectRefunded: args.expectRefunded,
      reason: args.reason,
      actor,
      channel: "cli",
      mfa: proof.mfa,
      requestId: args.requestId,
      env,
      fetchImpl,
      adapters,
      kek,
      mailConfig,
    });

    if (result.already) {
      out(
        `[billing:refund] ${result.paymentId}: this refund was already recorded (${result.refundId}, ${result.status})`,
      );
      return 0;
    }

    out(
      `[billing:refund] ${result.paymentId}: ${displayMoney(result.amount, result.currency)} ` +
        `${result.status}${result.full ? " (full)" : " (partial)"}`,
    );
    if (result.concurrent) {
      const who = result.concurrent.others
        .map((other) => other.email ?? other.id)
        .filter(Boolean)
        .join(", ");
      err(
        `[billing:refund] refund.concurrent: ${result.paymentId}: the refunded sum was ` +
          `${displayMoney(result.concurrent.expected, result.currency)} when checked and ` +
          `${displayMoney(result.concurrent.actual, result.currency)} when recorded; ` +
          `this refund is recorded${who ? `; also refunded by ${who}` : ""}. ` +
          "Both operators are in the journal with the warning.",
      );
    }
    if (!result.mailed) {
      err(
        `[billing:refund] ${result.paymentId}: refund recorded but the letter was not queued; notify ${result.recipient}`,
      );
    }
    out(
      `[billing:refund] ${result.refundId}: reason recorded; the payer was told at ${result.recipient}`,
    );
    return 0;
  } catch (error) {
    // The expectation mismatch has its own exit code (3), so a script can tell a repeated
    // command from a provider failure (1) (`spec/operator-actions.md` §1.1).
    if (error.code === "REFUND_STATE_CHANGED") {
      err(`[billing:refund] ${error.message}; check customer:show before repeating`);
      return 3;
    }
    err(`[billing:refund] ${error.code ? `${error.code}: ` : ""}${error.message ?? error}`);
    return 1;
  } finally {
    await opened?.close?.().catch(() => {});
  }
}
/**
 * Add a `goodwill` credit. One implementation for `pnpm billing:credit` and the console
 * (`spec/operator-actions.md` §1.3, §3.1 rule 4).
 */
export async function grantCredit({
  store,
  orgId,
  amount,
  currency = null,
  reason,
  actor,
  channel = "cli",
  mfa = null,
  env = process.env,
}) {
  const org = await store.operatorOrg(orgId);
  if (!org) throw codedError("ORG_NOT_FOUND", `no organisation ${orgId}`);
  const chosen =
    currency ?? (await store.operatorBillingCurrency(orgId)) ?? defaultCurrency(env);
  const credit = await store.withTenant(orgId, async () => {
    const row = await store.appendCredit({
      orgId,
      amount,
      currency: chosen,
      kind: "goodwill",
      note: reason,
      createdBy: actor?.id ?? null,
    });
    await store.recordAudit(
      operatorAudit({
        channel,
        mfa,
        actorId: actor?.id ?? null,
        orgId,
        action: "billing.credit_granted",
        subject: orgId,
        after: { amount, currency: chosen, ledgerId: row.id },
        reason,
      }),
    );
    return row;
  });
  return { org, credit, currency: chosen };
}

export async function runBillingCredit({
  argv,
  env = process.env,
  store = null,
  out = console.log,
  err = console.error,
  kek = undefined,
  stdin = process.stdin,
  stdout = process.stderr,
  ask = undefined,
} = {}) {
  let args;
  try {
    args = parseCreditArgs(argv);
  } catch (error) {
    err(`[billing:credit] ${error.message}`);
    err(CREDIT_USAGE);
    return 1;
  }
  if (args.help) {
    out(CREDIT_USAGE);
    return 0;
  }

  try {
    requireOperatorActorValue(args.as, env);
  } catch (error) {
    err(`[billing:credit] ${error.message}`);
    err(CREDIT_USAGE);
    return 1;
  }

  let opened = null;
  try {
    const active = store ?? (opened = openStore(env));
    if (!store) await active.connect();
    const actor = await requireOperatorActor(active, args.as, { env });
    let proof;
    try {
      proof = await assertOperatorCliMfa({
        store: active,
        actor,
        code: args.code,
        env,
        kek,
        stdin,
        stdout,
        ask,
      });
    } catch (error) {
      err(`[billing:credit] ${error.message ?? error}`);
      return 1;
    }
    const result = await grantCredit({
      store: active,
      orgId: args.orgId,
      amount: args.amount,
      currency: args.currency,
      reason: args.reason,
      actor,
      channel: "cli",
      mfa: proof.mfa,
      env,
    });
    out(
      `[billing:credit] ${result.org.slug}: +${displayMoney(args.amount, result.currency)} (ledger ${result.credit.id})`,
    );
    out("[billing:credit] the credit is applied to the next invoice automatically");
    return 0;
  } catch (error) {
    err(`[billing:credit] ${error.code ? `${error.code}: ` : ""}${error.message ?? error}`);
    return 1;
  } finally {
    await opened?.close?.().catch(() => {});
  }
}
