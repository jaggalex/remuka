/**
 * `billing:grant` (ADR-247, `spec/billing.md` §2.1, §2.4, §12 stage 1) and the console's
 * plan action (ADR-262 §3.2).
 *
 * Stage 1 has no checkout: the operator is the seller. The plan and its period are a
 * subscription row; the price is a snapshot copied from the price book, so a later
 * catalogue change never rewrites this organisation's history. `free` is the same act as
 * `--end`: it cancels the live subscription and thaws every room the limits had frozen.
 *
 * `grantPlan` is the act; `runBillingGrant` is the shell's door to it. The console calls
 * the same function (`spec/operator-actions.md` §3.1 rule 4).
 */
import { PLANS, PLAN_NAMES } from "./billing-catalog.mjs";
import { operatorAudit } from "./operator-audit.mjs";
import { assertOperatorCliMfa } from "./operator-cli-mfa.mjs";
import { requireOperatorActor, requireOperatorActorValue } from "./operator-role.mjs";
import { PostgresStore } from "./postgres.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const GRANT_USAGE = `usage:
  pnpm billing:grant --org <organisation-id> --plan <${PLAN_NAMES.join("|")}> --until YYYY-MM-DD
                     [--currency RUB] [--price <price-id>] --as <operator> [--code <six digits>]
  pnpm billing:grant --org <organisation-id> --end --as <operator> [--code <six digits>]

  --until is the last day of the grant, inclusive, interpreted as the end of that day in UTC.
  It must be in the future. Without --price the command picks the for-sale price of the
  plan for one month in --currency (default: the first REMO_BILLING_CURRENCIES entry, else RUB).
  --plan free and --end both cancel the live subscription; no price is read.
  --as names the operator; REMO_OPERATOR is the fallback. Required.
  --code is the operator's six-digit second-factor code (or a recovery code); asked
  interactively in a terminal and required otherwise.`;

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function readFlags(args, booleans = new Set()) {
  const flags = new Map();
  const positionals = [];
  for (let index = 0; index < args.length; index += 1) {
    const item = args[index];
    if (!item.startsWith("--")) {
      positionals.push(item);
      continue;
    }
    const name = item.slice(2);
    if (booleans.has(name)) {
      flags.set(name, true);
      continue;
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`--${name} needs a value`);
    }
    flags.set(name, value);
    index += 1;
  }
  return { flags, positionals };
}

function rejectUnknown(flags, allowed) {
  for (const name of flags.keys()) {
    if (!allowed.includes(name)) throw new Error(`billing:grant does not take --${name}`);
  }
}

/**
 * End of `YYYY-MM-DD` in UTC. `noUnchecked` dates such as 2027-02-30 roll over silently
 * in `Date`, so the parsed value must name the same calendar day that was typed.
 */
export function parseUntil(raw, now = new Date()) {
  const text = String(raw ?? "").trim();
  if (!DATE.test(text)) throw new Error("--until must be a date in the form YYYY-MM-DD");
  const until = new Date(`${text}T23:59:59.999Z`);
  if (Number.isNaN(until.getTime()) || until.toISOString().slice(0, 10) !== text) {
    throw new Error(`--until ${text} is not a real calendar date`);
  }
  if (until.getTime() <= now.getTime()) {
    throw new Error(`--until ${text} must be in the future`);
  }
  return until;
}

/**
 * Parse the grant command line. Pure apart from the clock, which is a parameter so a
 * test can pin "future" without depending on the day it runs.
 */
export function parseGrantArgs(argv, { now = new Date() } = {}) {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    return { help: true };
  }
  const { flags, positionals } = readFlags(argv, new Set(["end"]));
  rejectUnknown(flags, ["org", "plan", "until", "currency", "price", "end", "as", "code"]);
  if (positionals.length > 0) throw new Error(`unexpected argument ${positionals[0]}`);

  const orgId = String(flags.get("org") ?? "").trim();
  if (!UUID.test(orgId)) {
    throw new Error("--org <organisation id> is required and must be a UUID");
  }
  const as = flags.has("as") ? String(flags.get("as")).trim() : null;
  if (as === "") throw new Error("--as needs an operator id or email address");
  const code = flags.has("code") ? String(flags.get("code")).trim() : null;
  if (code === "") throw new Error("--code needs the six-digit code from the app");

  if (flags.has("end")) {
    for (const name of ["plan", "until", "currency", "price"]) {
      if (flags.has(name)) throw new Error(`--end does not take --${name}`);
    }
    return { help: false, orgId, end: true, plan: "free", until: null, currency: null, priceId: null, as, code };
  }

  const plan = String(flags.get("plan") ?? "").trim();
  if (!PLAN_NAMES.includes(plan)) {
    throw new Error(`--plan must be one of ${PLAN_NAMES.join(", ")}`);
  }

  // Free is not a subscription: it is the absence of one. Reusing the end path keeps
  // `subscriptions.plan` from ever holding a row that `entitlementsFor` would ignore.
  if (plan === "free") {
    for (const name of ["until", "currency", "price"]) {
      if (flags.has(name)) throw new Error(`--plan free has no period and no price; use --end`);
    }
    return { help: false, orgId, end: true, plan: "free", until: null, currency: null, priceId: null, as, code };
  }

  if (!flags.has("until")) throw new Error("--until YYYY-MM-DD is required for a paid plan");
  const until = parseUntil(flags.get("until"), now);
  const currency = flags.has("currency") ? String(flags.get("currency")).trim().toUpperCase() : null;
  if (currency !== null && !/^[A-Z]{3}$/.test(currency)) {
    throw new Error("--currency must be an ISO 4217 code");
  }
  let priceId = null;
  if (flags.has("price")) {
    priceId = String(flags.get("price")).trim().toLowerCase();
    if (!priceId) throw new Error("--price needs a price id");
  }
  return { help: false, orgId, end: false, plan, until, currency, priceId, as, code };
}

function openStore(env) {
  const connectionString = env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required: subscriptions live in Postgres");
  }
  return new PostgresStore({
    connectionString,
    migrationConnectionString: env.REMO_MIGRATION_DATABASE_URL ?? connectionString,
    log: console,
  });
}

function billingCurrencies(env = process.env) {
  const list = String(env.REMO_BILLING_CURRENCIES ?? "")
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
  return list.length > 0 ? list : ["RUB"];
}

function formatAmount(amount, currency) {
  const value = Math.trunc(Number(amount));
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")} ${currency}`;
}

async function resolvePrice(store, { plan, priceId, currency, env }) {
  if (priceId) {
    const prices = await store.listPrices({});
    const price = prices.find((row) => row.id === priceId);
    if (!price) throw codedError("PRICE_NOT_FOUND", `no price ${priceId}`);
    if (price.plan !== plan) {
      throw codedError("PRICE_PLAN_MISMATCH", `price ${price.id} belongs to ${price.plan}, not ${plan}`);
    }
    if (price.status !== "for_sale") {
      throw codedError("PRICE_NOT_FOR_SALE", `price ${price.id} is ${price.status}, not for sale`);
    }
    if (price.promo_only) {
      throw codedError("PRICE_PROMO_ONLY", `price ${price.id} is promo-only`);
    }
    if (currency && price.currency !== currency) {
      throw codedError(
        "PRICE_CURRENCY_MISMATCH",
        `price ${price.id} is in ${price.currency}, not ${currency}`,
      );
    }
    return price;
  }
  const chosenCurrency = currency ?? billingCurrencies(env)[0];
  const price = await store.priceForSale({ plan, interval: "month", currency: chosenCurrency });
  if (!price) {
    throw codedError(
      "PRICE_MISSING",
      `no price for sale for ${plan}/month/${chosenCurrency}; seed prices first`,
    );
  }
  return price;
}

/**
 * Give a plan or end it. The same act for the CLI and the console.
 *
 * @returns {Promise<{orgId: string, plan: string, until: Date|null, ended: boolean,
 *   price: object|null, subscription: object|null}>}
 */
export async function grantPlan({
  store,
  orgId,
  plan,
  until = null,
  currency = null,
  priceId = null,
  end = false,
  reason,
  actor,
  channel = "cli",
  mfa = null,
  env = process.env,
}) {
  const org = await store.operatorOrg(orgId);
  if (!org) throw codedError("ORG_NOT_FOUND", `no organisation ${orgId}`);
  const ends = end || plan === "free";
  const auditReason = reason?.trim() || (ends
    ? "plan ended from the operator's shell"
    : "plan granted from the operator's shell");

  if (ends) {
    const canceled = await store.withTenant(orgId, async () => {
      const ended = await store.endOperatorPlan(orgId);
      await store.reconcileFrozenRooms(orgId, null);
      await store.recordAudit(
        operatorAudit({
          channel,
          mfa,
          actorId: actor.id,
          orgId,
          action: "billing.plan_ended",
          subject: orgId,
          after: { canceled: ended },
          reason: auditReason,
        }),
      );
      return ended;
    });
    return { orgId, plan: "free", until: null, ended: true, price: null, subscription: canceled };
  }

  const result = await store.withTenant(orgId, async () => {
    const chosen = await resolvePrice(store, { plan, priceId, currency, env });
    const subscription = await store.upsertOperatorPlan({
      orgId,
      plan,
      priceId: chosen.id,
      amount: chosen.amount,
      currency: chosen.currency,
      interval: chosen.interval,
      until,
    });
    await store.reconcileFrozenRooms(orgId, PLANS[plan].rooms);
    await store.recordAudit(
      operatorAudit({
        channel,
        mfa,
        actorId: actor.id,
        orgId,
        action: "billing.plan_granted",
        subject: orgId,
        after: {
          plan,
          priceId: chosen.id,
          amount: chosen.amount,
          currency: chosen.currency,
          interval: chosen.interval,
          until: until.toISOString(),
        },
        reason: auditReason,
      }),
    );
    return { price: chosen, subscription };
  });
  return { orgId, plan, until, ended: false, ...result };
}

export async function runBillingGrant({
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
    args = parseGrantArgs(argv);
  } catch (error) {
    err(`[billing:grant] ${error.message}`);
    err(GRANT_USAGE);
    return 1;
  }
  if (args.help) {
    out(GRANT_USAGE);
    return 0;
  }

  let actorValue;
  try {
    actorValue = requireOperatorActorValue(args.as, env);
  } catch (error) {
    err(`[billing:grant] ${error.message}`);
    err(GRANT_USAGE);
    return 1;
  }

  let opened = null;
  try {
    const active = store ?? (opened = openStore(env));
    if (!store) await active.connect();
    const actor = await requireOperatorActor(active, actorValue, { env });
    // The plan and its period are money: the acting operator proves the second factor
    // (ADR-262 §5). `operator:grant` and `mfa:reset` are the exceptions, not this one.
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
      err(`[billing:grant] ${error.message ?? error}`);
      return 1;
    }

    const result = await grantPlan({
      store: active,
      orgId: args.orgId,
      plan: args.plan,
      until: args.until,
      currency: args.currency,
      priceId: args.priceId,
      end: args.end,
      actor,
      channel: "cli",
      mfa: proof.mfa,
      env,
    });

    if (result.ended) {
      out(
        `[billing:grant] org ${args.orgId}: Free` +
          (result.subscription ? " (live subscription canceled)" : " (there was no live subscription)"),
      );
      out("[billing:grant] every room freeze was removed; the entitlements cache expires within 60 s");
      return 0;
    }

    const rooms = PLANS[result.plan].rooms;
    out(
      `[billing:grant] org ${args.orgId}: ${result.plan} until ` +
        `${result.until.toISOString()} for ${formatAmount(result.price.amount, result.price.currency)} ` +
        `(${result.price.id}, ${result.subscription.interval})`,
    );
    out(
      `[billing:grant] rooms ${rooms === null ? "unlimited" : `limited to ${rooms}`}; ` +
        "the entitlements cache in this and other processes expires within 60 s",
    );
    return 0;
  } catch (error) {
    err(`[billing:grant] ${error.code ? `${error.code}: ` : ""}${error.message ?? error}`);
    return 1;
  } finally {
    await opened?.close?.().catch(() => {});
  }
}
