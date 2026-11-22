/**
 * `pnpm stage:seed` (ADR-261, `spec/stage.md` §6).
 *
 * The fixtures interface acceptance needs, recreated on a stand and nowhere else. The
 * seed is a reset of test data, not a demo: fixed addresses, fixed room ids and fixed
 * plan state, so two runs leave the same database and a scenario can start from the same
 * picture every time.
 *
 * The command refuses without `REMO_STAGE=1`, and it reads the password and the address
 * domain from the instance's own environment: a fixture password in the repository would
 * be a login to every stand that ever ran this file.
 */
import { hashPassword } from "./iam.mjs";
import { PLANS } from "./billing-catalog.mjs";
import { settleInvoice } from "./billing-settle.mjs";
import { legalAcceptanceRows, resolveLegal } from "./legal.mjs";
import { assertStage, isStage } from "./stage.mjs";

/** The five Free rooms; one of them is the public-link room. */
export const OWNER_ROOMS = Object.freeze([
  { id: "stage-owner-room-1", title: "Стенд: обзор" },
  { id: "stage-owner-room-2", title: "Стенд: спринт" },
  { id: "stage-owner-room-3", title: "Стенд: клиенты" },
  { id: "stage-owner-room-4", title: "Стенд: запуск" },
  { id: "stage-owner-room-5", title: "Стенд: архив идей" },
]);

/** The room a public link opens; its password is the literal `stage` (§6). */
export const PUBLIC_ROOM = OWNER_ROOMS[0].id;
export const PUBLIC_LINK_PASSWORD = "stage";

/** A repeated run keeps one price and one invoice, not a new sale each time. */
export const SEED_PRICE_ID = "stage-pro-month";

function required(env, key) {
  const value = String(env?.[key] ?? "").trim();
  if (!value) {
    throw new Error(
      `${key} is required for stage:seed: the fixture addresses and password live in ` +
        "the instance's production.env, never in the repository (spec/stage.md §6)",
    );
  }
  return value;
}

/** `example.test` and `@example.test` mean the same domain; an address is an error. */
export function seedDomain(raw) {
  const value = String(raw ?? "").trim().toLowerCase().replace(/^@/, "");
  if (!/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(value) || value.includes("@")) {
    throw new Error(`REMO_STAGE_SEED_DOMAIN is not a domain: ${JSON.stringify(raw)}`);
  }
  return value;
}

export function seedPassword(env) {
  const value = required(env, "REMO_STAGE_SEED_PASSWORD");
  if (value.length < 8) {
    throw new Error("REMO_STAGE_SEED_PASSWORD must be at least 8 characters");
  }
  return value;
}

async function ensureUser(store, { email, name, handle, password }) {
  let user = await store.findUserByEmail(email);
  if (!user) {
    const taken = await store.findUserByHandle(handle);
    const unique = taken ? `${handle}-${Date.now().toString(36).slice(-4)}` : handle;
    user = await store.createUser({
      email,
      passwordHash: await hashPassword(password),
      name,
      handle: unique,
    });
  } else {
    // Deterministic: a scenario signs in with the environment's password even after a
    // previous run or a manual change.
    await store.updatePassword(user.id, await hashPassword(password));
  }
  return user;
}

async function ensureOrg(store, { owner, slug, name }) {
  const existing = await store.getOrgBySlug?.(slug);
  if (existing?.id) return existing;
  const { org } = await store.createOrgWithOwner({
    name,
    slug,
    userId: owner.id,
    kind: "shared",
  });
  return org;
}

async function primaryTeamId(store, orgId) {
  const { rows } = await store.pool.query(
    "select id from teams where org_id = $1 order by created_at limit 1",
    [orgId],
  );
  return rows[0]?.id ?? null;
}

async function ensureBoard(store, { orgId, teamId, ownerId, id, title }) {
  await store.createIamBoard({ id, orgId, teamId, ownerId, title });
}

/**
 * The Pro fixture: a real invoice settled by a test payment, not a hand-written plan row.
 * A manual payment has no provider route, so the ledger uses its documented null route.
 */
async function ensureProPlan(store, { orgId, ownerId, currency, log }) {
  const live = await store.withTenant(orgId, () => store.liveSubscription(orgId));
  if (live?.plan === "pro") return { plan: "pro", paid: false };

  let price = await store.priceById(SEED_PRICE_ID);
  if (!price) {
    await store.addPrice({
      id: SEED_PRICE_ID,
      plan: "pro",
      interval: "month",
      currency,
      amount: 1000,
      createdBy: ownerId,
    });
    await store.publishPrice(SEED_PRICE_ID);
    price = await store.priceById(SEED_PRICE_ID);
  }

  const start = new Date();
  const end = new Date(start.getTime() + 30 * 24 * 60 * 60 * 1000);
  const { invoice } = await store.withTenant(orgId, () =>
    store.createInvoice({
      orgId,
      currency,
      lines: [
        {
          kind: "subscription",
          plan: "pro",
          interval: "month",
          priceId: price.id,
          amount: Number(price.amount),
        },
      ],
      subtotal: Number(price.amount),
      total: Number(price.amount),
      periodStart: start,
      periodEnd: end,
      dueAt: end,
    }),
  );
  const stored = await store.billingInvoiceGlobal(invoice.id);
  await settleInvoice({ store, invoice: stored, providerPaymentId: "stage-seed" });
  log.log(`seed: pro organisation paid by a test invoice ${invoice.id}`);
  return { plan: "pro", paid: true };
}

/** The current revision of every required document, so only `legacy@` lacks them. */
async function ensureAcceptances(store, { user, env, zone }) {
  const legal = resolveLegal(env, { zone });
  const rows = legalAcceptanceRows(legal);
  if (!rows.length) return 0;
  const current = await store.latestLegalAcceptances(user.id);
  const accepted = new Set(
    current.filter((row) => row.event !== "withdraw").map((row) => `${row.doc}@${row.version}`),
  );
  const missing = rows.filter((row) => !accepted.has(`${row.doc}@${row.version}`));
  if (!missing.length) return 0;
  await store.recordLegalAcceptances({ userId: user.id, rows: missing });
  return missing.length;
}

async function clearAcceptances(store, userId) {
  await store.pool.query("delete from legal_acceptances where user_id = $1", [userId]);
}

/**
 * Create or repair every fixture. The returned object is what `stage:reset` logs; it
 * never contains a password.
 */
export async function runStageSeed({ env = process.env, store, log = console } = {}) {
  assertStage(env, "stage:seed");
  if (!store) throw new Error("stage:seed needs an open Postgres store");

  const domain = seedDomain(required(env, "REMO_STAGE_SEED_DOMAIN"));
  const password = seedPassword(env);
  const currency = String(env.REMO_BILLING_CURRENCIES ?? "RUB")
    .split(",")[0]
    .trim()
    .toUpperCase() || "RUB";
  const zone = String(env.REMO_COMPLIANCE_ZONE ?? "none").trim() || "none";

  const owner = await ensureUser(store, {
    email: `owner@${domain}`,
    name: "Владелец стенда",
    handle: "stage-owner",
    password,
  });
  const pro = await ensureUser(store, {
    email: `pro@${domain}`,
    name: "Pro стенд",
    handle: "stage-pro",
    password,
  });
  const colleague = await ensureUser(store, {
    email: `colleague@${domain}`,
    name: "Коллега стенда",
    handle: "stage-colleague",
    password,
  });
  const legacy = await ensureUser(store, {
    email: `legacy@${domain}`,
    name: "Без документов",
    handle: "stage-legacy",
    password,
  });
  const operator = await ensureUser(store, {
    email: `operator@${domain}`,
    name: "Оператор стенда",
    handle: "stage-operator",
    password,
  });

  const ownerOrg = await ensureOrg(store, {
    owner,
    slug: "stage-owner",
    name: "Стенд: владелец",
  });
  const proOrg = await ensureOrg(store, {
    owner: pro,
    slug: "stage-pro",
    name: "Стенд: Pro",
  });

  await store.withTenant(ownerOrg.id, async () => {
    const teamId = await primaryTeamId(store, ownerOrg.id);
    for (const room of OWNER_ROOMS) {
      await ensureBoard(store, {
        orgId: ownerOrg.id,
        teamId,
        ownerId: owner.id,
        id: room.id,
        title: room.title,
      });
    }
    // The public link is a board property; the organisation must allow one.
    await store.pool.query(
      `insert into org_policies (org_id, public_links) values ($1, true)
       on conflict (org_id) do update set public_links = true`,
      [ownerOrg.id],
    );
    await store.pool.query(
      `insert into org_memberships (org_id, user_id, relation, state)
       values ($1, $2, 'member', 'active')
       on conflict (org_id, user_id) do update set relation = 'member', state = 'active'`,
      [ownerOrg.id, colleague.id],
    );
    const team = await primaryTeamId(store, ownerOrg.id);
    if (team) {
      await store.pool.query(
        `insert into team_memberships (team_id, user_id, role)
         values ($1, $2, 'member')
         on conflict (team_id, user_id, source) do nothing`,
        [team, colleague.id],
      );
    }
    // Re-applied every run: the password is the documented fixture, so a changed one is
    // repaired instead of silently breaking S-34/S-35.
    await store.enableBoardLink({
      boardId: PUBLIC_ROOM,
      role: "viewer",
      createdBy: owner.id,
      passwordHash: await hashPassword(PUBLIC_LINK_PASSWORD),
      confirmDraftSharing: true,
    });
  });

  await store.withTenant(proOrg.id, async () => {
    const teamId = await primaryTeamId(store, proOrg.id);
    await ensureBoard(store, {
      orgId: proOrg.id,
      teamId,
      ownerId: pro.id,
      id: "stage-pro-room",
      title: "Стенд: Pro",
    });
  });
  await ensureProPlan(store, { orgId: proOrg.id, ownerId: pro.id, currency, log });

  // The operator screen is reachable without a second factor: the fixture exists to
  // test recovery, not to protect test data (§6). A real stand operator enrols TOTP.
  await store.grantInstanceOperator({ email: operator.email, grantedBy: operator.id });
  await store.pool.query("delete from user_mfa_recovery_codes where user_id = $1", [operator.id]);
  await store.pool.query("delete from user_mfa where user_id = $1", [operator.id]);

  const accepted = {};
  for (const [label, user] of [
    ["owner", owner],
    ["pro", pro],
    ["colleague", colleague],
    ["operator", operator],
  ]) {
    accepted[label] = await ensureAcceptances(store, { user, env, zone });
  }
  // `legacy@` is the account without acceptances; a rerun restores that state even if a
  // scenario accepted the documents by hand.
  await clearAcceptances(store, legacy.id);

  const summary = {
    domain,
    owner: owner.email,
    pro: pro.email,
    colleague: colleague.email,
    legacy: legacy.email,
    operator: operator.email,
    rooms: OWNER_ROOMS.length,
    publicRoom: PUBLIC_ROOM,
    planFreeRooms: PLANS.free.rooms,
    planPro: "pro",
    acceptances: accepted,
  };
  log.log(
    `seed: ${summary.rooms} Free rooms for ${summary.owner}, Pro for ${summary.pro}, ` +
      `operator ${summary.operator} without TOTP, public room ${summary.publicRoom}`,
  );
  log.log("seed: fixture password comes from REMO_STAGE_SEED_PASSWORD and is not printed");
  return summary;
}

/** The command wrapper: only a stand, only Postgres. */
export async function seedFromEnvironment({ env = process.env, log = console } = {}) {
  if (!isStage(env)) assertStage(env, "stage:seed");
  const { PostgresStore } = await import("./postgres.mjs");
  const connectionString = env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required: stage:seed fills the instance's Postgres");
  }
  const store = new PostgresStore({
    connectionString,
    migrationConnectionString: env.REMO_MIGRATION_DATABASE_URL ?? connectionString,
    log,
  });
  try {
    await store.connect();
    await store.migrate();
    return await runStageSeed({ env, store, log });
  } finally {
    await store.close().catch(() => {});
  }
}
