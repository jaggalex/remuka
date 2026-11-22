/**
 * `billing:mark-paid` (ADR-247, `spec/billing.md` §4, stage 2) and the console's manual
 * payment action (ADR-262 §3.2).
 *
 * The operator is the only source of truth for a manual payment: the act records the
 * payment, applies the credit the invoice promised, and — when the invoice sells a
 * subscription — gives the organisation that plan until the end of the period. Running it
 * twice changes nothing.
 *
 * Every money act names its author (ADR-259 amendment) and the one implementation is
 * shared by the shell and the console (`spec/operator-actions.md` §3.1 rule 4).
 */
import { settleInvoice } from "./billing-settle.mjs";
import { operatorAudit } from "./operator-audit.mjs";
import { assertOperatorCliMfa } from "./operator-cli-mfa.mjs";
import { requireOperatorActor, requireOperatorActorValue } from "./operator-role.mjs";
import { PostgresStore } from "./postgres.mjs";

export const MARK_PAID_USAGE = `usage:
  pnpm billing:mark-paid <invoice-id> --reason "..." [--ref <bank reference>] --as <operator>
                    [--code <six digits>]

  --reason   why the payment is confirmed; stored in the audit row. Required.
  --ref      the bank's reference for this transfer; becomes the payment's provider id.
  --as       the operator performing the command, an id or an address. Required;
             REMO_OPERATOR is the fallback.
  --code     the operator's six-digit second-factor code (or a recovery code). Asked
             interactively in a terminal; required otherwise.`;

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function parseMarkPaidArgs(argv) {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    return { help: true };
  }
  let invoiceId = null;
  let reason = null;
  let ref = null;
  let as = null;
  let code = null;
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) {
      if (invoiceId) throw new Error(`unexpected argument ${item}`);
      invoiceId = item.trim();
      continue;
    }
    const name = item.slice(2);
    if (!["reason", "ref", "as", "code"].includes(name)) {
      throw new Error(`billing:mark-paid does not take --${name}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`--${name} needs a value`);
    }
    if (name === "reason") reason = value.trim();
    if (name === "ref") ref = value.trim();
    if (name === "as") as = value.trim();
    if (name === "code") code = value.trim();
    index += 1;
  }
  if (!invoiceId) throw new Error("the invoice id is required");
  if (!reason) throw new Error("--reason is required: a payment without a reason is refused");
  if (as === "") throw new Error("--as needs an operator id or email address");
  if (ref === "") throw new Error("--ref needs a bank reference");
  if (code === "") throw new Error("--code needs the six-digit code from the app");
  return { help: false, invoiceId, reason, ref, as, code };
}

function openStore(env) {
  const connectionString = env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required: invoices live in Postgres");
  }
  return new PostgresStore({
    connectionString,
    migrationConnectionString: env.REMO_MIGRATION_DATABASE_URL ?? connectionString,
    log: console,
  });
}

/**
 * Confirm a manual payment. The same act for the CLI and the console.
 *
 * @returns {Promise<{alreadyPaid: boolean, invoice: object, settled: object|null}>}
 */
export async function markInvoicePaid({
  store,
  invoiceId,
  reason,
  ref = null,
  actor,
  channel = "cli",
  mfa = null,
}) {
  const invoice = await store.billingInvoiceGlobal(invoiceId);
  if (!invoice) throw codedError("INVOICE_NOT_FOUND", `no invoice ${invoiceId}`);
  if (invoice.status === "void") throw codedError("INVOICE_VOID", `${invoice.number} is void`);
  if (invoice.status === "paid") return { alreadyPaid: true, invoice, settled: null };

  // The fake provider's page settles through the same function, so a browser test and
  // an operator action cannot disagree about what "paid" means.
  const settled = await settleInvoice({
    store,
    invoice,
    providerPaymentId: ref ? `manual:${ref}` : `manual:${invoice.id}`,
  });

  await store.withTenant(invoice.org_id, () =>
    store.recordAudit(
      operatorAudit({
        channel,
        mfa,
        actorId: actor.id,
        orgId: invoice.org_id,
        action: "billing.invoice_marked_paid",
        subject: invoice.id,
        after: {
          number: invoice.number,
          amount: Number(invoice.total),
          currency: invoice.currency,
          paymentId: settled.payment?.id ?? null,
          ref,
          plan: settled.subscription?.plan ?? null,
        },
        reason,
      }),
    ),
  );

  return { alreadyPaid: false, invoice, settled };
}

export async function runBillingMarkPaid({
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
    args = parseMarkPaidArgs(argv);
  } catch (error) {
    err(`[billing:mark-paid] ${error.message}`);
    err(MARK_PAID_USAGE);
    return 1;
  }
  if (args.help) {
    out(MARK_PAID_USAGE);
    return 0;
  }

  let actorValue;
  try {
    actorValue = requireOperatorActorValue(args.as, env);
  } catch (error) {
    err(`[billing:mark-paid] ${error.message}`);
    err(MARK_PAID_USAGE);
    return 1;
  }

  let opened = null;
  try {
    const active = store ?? (opened = openStore(env));
    if (!store) await active.connect();
    const actor = await requireOperatorActor(active, actorValue, { env });

    // Read the invoice before asking for a code: nothing above moves money.
    const found = await active.billingInvoiceGlobal(args.invoiceId);
    if (!found) {
      err(`[billing:mark-paid] no invoice ${args.invoiceId}`);
      return 1;
    }
    if (found.status === "void") {
      err(`[billing:mark-paid] ${found.number} is void`);
      return 1;
    }
    if (found.status === "paid") {
      out(`[billing:mark-paid] ${found.number} is already paid`);
      return 0;
    }

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
      err(`[billing:mark-paid] ${error.message ?? error}`);
      return 1;
    }

    const result = await markInvoicePaid({
      store: active,
      invoiceId: args.invoiceId,
      reason: args.reason,
      ref: args.ref,
      actor,
      channel: "cli",
      mfa: proof.mfa,
    });
    out(
      `[billing:mark-paid] ${result.invoice.number} paid: ${result.invoice.total} ${result.invoice.currency}` +
        (result.settled?.subscription ? ` → ${result.settled.subscription.plan}` : ""),
    );
    return 0;
  } catch (error) {
    err(`[billing:mark-paid] ${error.code ? `${error.code}: ` : ""}${error.message ?? error}`);
    return 1;
  } finally {
    await opened?.close?.().catch(() => {});
  }
}
