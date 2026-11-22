/**
 * `customer:show --email <address> | --org <id|slug>` (ADR-259, `spec/operator.md` §3).
 *
 * The support card: who the customer is, which organisations they belong to, the plan and
 * subscription, invoices and payments, member and room counts, accepted documents and the
 * operator's own measures. It never selects a room title or content: the operator answers
 * billing and access questions from metadata, and a complaint brings its own screenshot
 * (§1 rule 3).
 */
import { PostgresStore } from "./postgres.mjs";

export const CUSTOMER_SHOW_USAGE = `usage:
  pnpm customer:show --email <address>
  pnpm customer:show --org <organisation-id|slug>

Prints the support card: organisations, plan and subscription, invoices, payments,
credit, member and room counts, accepted documents and operator measures. Room names
and room content are never read.`;

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

export function parseCustomerShowArgs(argv) {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    return { help: true };
  }
  const { flags, positionals } = readFlags(argv);
  if (positionals.length > 0) throw new Error(`unexpected argument ${positionals[0]}`);
  for (const name of flags.keys()) {
    if (!["email", "org"].includes(name)) throw new Error(`customer:show does not take --${name}`);
  }
  const email = flags.has("email") ? String(flags.get("email")).trim().toLowerCase() : null;
  const org = flags.has("org") ? String(flags.get("org")).trim() : null;
  if (!email && !org) throw new Error("one of --email or --org is required");
  if (email && org) throw new Error("choose one of --email or --org");
  if (email && !email.includes("@")) throw new Error("--email must be an email address");
  return { help: false, email, org };
}

function iso(value) {
  if (!value) return "—";
  const at = value instanceof Date ? value : new Date(value);
  return Number.isNaN(at.getTime()) ? "—" : at.toISOString();
}

/** Minor units to a stable display string; the card is read, not parsed as money. */
export function displayAmount(amount, currency) {
  const value = Number(amount);
  if (!Number.isFinite(value)) return `— ${currency ?? ""}`.trim();
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(value));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")} ${currency ?? ""}`.trim();
}

function subscriptionLine(subscription) {
  if (!subscription) return "subscription: none";
  return (
    `subscription: ${subscription.plan}/${subscription.status} ` +
    `${displayAmount(subscription.amount, subscription.currency)} per ${subscription.interval}` +
    `, period ${iso(subscription.current_period_start)} → ${iso(subscription.current_period_end)}` +
    (subscription.cancel_at_period_end ? " (cancels at period end)" : "") +
    (subscription.trial_end ? `, trial ends ${iso(subscription.trial_end)}` : "")
  );
}

/**
 * One stable block, one line per fact. The same text is what the test reads, so a room
 * title can never sneak into the card through a formatting branch.
 */
export function formatCustomerCard(card) {
  const lines = [];
  if (card.user) {
    lines.push(
      `account ${card.user.id} ${card.user.email} state=${card.user.state}` +
        `, created ${iso(card.user.createdAt)}` +
        `, address ${card.user.emailVerifiedAt ? `confirmed ${iso(card.user.emailVerifiedAt)}` : "not confirmed"}`,
    );
  }
  lines.push(`organisations: ${card.orgs.length}`);
  for (const org of card.orgs) {
    lines.push(
      `\n${org.name || "(untitled)"} (${org.slug}) ${org.kind}, id ${org.id}, created ${iso(org.createdAt)}` +
        (org.suspendedAt
          ? ` — SUSPENDED ${iso(org.suspendedAt)}${org.suspensionRef ? ` (${org.suspensionRef})` : ""}`
          : ""),
    );
    if (org.relation) {
      lines.push(
        `  membership: ${org.relation}/${org.membershipState}` +
          (org.roles?.length ? `, roles ${org.roles.join(", ")}` : ""),
      );
    }
    lines.push(`  ${subscriptionLine(org.subscription)}`);
    lines.push(
      org.billing
        ? `  billing: ${org.billing.email}${org.billing.name ? ` (${org.billing.name})` : ""}` +
            `${org.billing.currency ? `, ${org.billing.currency}` : ""}` +
            `${org.billing.testMode ? ", test mode" : ""}`
        : "  billing: none",
    );
    lines.push(
      `  members: ${org.counts.members}, guests: ${org.counts.guests}, rooms: ${org.counts.rooms}`,
    );
    if (org.admins?.length) {
      lines.push(`  administrators: ${org.admins.map((admin) => admin.email).join(", ")}`);
    }
    if (org.credit?.length) {
      lines.push(
        `  credit: ${org.credit.map((entry) => displayAmount(entry.balance, entry.currency)).join(", ")}`,
      );
    }
    if (org.invoices.length === 0) {
      lines.push("  invoices: none");
    } else {
      lines.push("  invoices:");
      for (const invoice of org.invoices) {
        lines.push(
          `    ${invoice.number} ${invoice.status} ${displayAmount(invoice.total, invoice.currency)}` +
            ` created ${iso(invoice.created_at)}` +
            (invoice.paid_at ? ` paid ${iso(invoice.paid_at)}` : ""),
        );
      }
    }
    if (org.payments.length === 0) {
      lines.push("  payments: none");
    } else {
      lines.push("  payments:");
      for (const payment of org.payments) {
        lines.push(
          `    ${iso(payment.created_at)} ${payment.status} ` +
            `${displayAmount(payment.amount, payment.currency)} invoice ${payment.invoice_number}` +
            `, refunded ${displayAmount(payment.refunded ?? 0, payment.currency)}`,
        );
      }
    }
    if (org.acceptances.length === 0) {
      lines.push("  accepted documents: none");
    } else {
      lines.push("  accepted documents:");
      for (const acceptance of org.acceptances) {
        lines.push(
          `    ${acceptance.zone}/${acceptance.doc} v${acceptance.version} ${acceptance.event}` +
            `${acceptance.user_email ? ` by ${acceptance.user_email}` : ""}` +
            ` at ${iso(acceptance.accepted_at)}`,
        );
      }
    }
    if (org.actions.length === 0) {
      lines.push("  operator measures: none");
    } else {
      lines.push("  operator measures:");
      for (const action of org.actions) {
        lines.push(
          `    ${action.kind} at ${iso(action.createdAt)} ` +
            `${action.revertedAt ? `reverted ${iso(action.revertedAt)}` : "OPEN"}` +
            ` — public: ${action.reasonPublic}; internal: ${action.reasonInternal}`,
        );
      }
    }
  }
  return lines.join("\n");
}

function openStore(env) {
  const connectionString = env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required: customers live in Postgres");
  return new PostgresStore({
    connectionString,
    migrationConnectionString: env.REMO_MIGRATION_DATABASE_URL ?? connectionString,
    log: console,
  });
}

export async function runCustomerShow({
  argv,
  env = process.env,
  store = null,
  out = console.log,
  err = console.error,
} = {}) {
  let args;
  try {
    args = parseCustomerShowArgs(argv);
  } catch (error) {
    err(`[customer:show] ${error.message}`);
    err(CUSTOMER_SHOW_USAGE);
    return 1;
  }
  if (args.help) {
    out(CUSTOMER_SHOW_USAGE);
    return 0;
  }

  let opened = null;
  try {
    const active = store ?? (opened = openStore(env));
    if (!store) await active.connect();
    const card = args.email
      ? await active.operatorCustomerByEmail(args.email)
      : await active.operatorCustomerByOrg(args.org);
    if (!card) {
      err(`[customer:show] no ${args.email ? `account with the address ${args.email}` : `organisation ${args.org}`}`);
      return 1;
    }
    out(formatCustomerCard(card));
    return 0;
  } catch (error) {
    err(`[customer:show] ${error.message ?? error}`);
    return 1;
  } finally {
    await opened?.close?.().catch(() => {});
  }
}
