import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accessForBoard } from "./iam-http.mjs";
import { totpCode, totpStep } from "./mfa.mjs";
import { runAbuse } from "./operator-abuse.mjs";
import { encryptSecret } from "./secrets.mjs";
import { testDatabaseStore } from "./test-db.mjs";

/**
 * Measures against abuse against a real database (ADR-259, `spec/operator.md` §4, §9).
 *
 * The open row is what access reads: a link stops opening for a visitor while the grant
 * still works for members, a hidden room stays with the organisation's administrators, and
 * a suspended organisation answers ORG_SUSPENDED. Each measure writes `operator_actions`,
 * an audit row and one letter per administrator; a revert closes the row and letters them
 * again.
 */
const opened = await testDatabaseStore("operator-abuse");
const store = opened?.store ?? null;

const orgId = randomUUID();
const adminId = randomUUID();
const memberId = randomUUID();
const boardId = `abuse-${orgId}`;
const actionIds = [];

const mailConfig = {
  driver: "console",
  from: "Remuka <no-reply@example.test>",
  replyTo: null,
  productName: null,
  consoleFile: null,
  resendApiKey: "",
  smtpUrl: "",
  appOrigin: "https://app.example.test",
  batch: 10,
  requireVerifiedForInvites: true,
  isProduction: false,
};

const KEK = { key: Buffer.alloc(32, 13), id: "v1" };
const SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const env = {
  DATABASE_URL: "unused",
  REMO_CONTACT_ABUSE: "abuse@example.test",
  REMO_COMPLIANCE_ZONE: "none",
  REMO_KEK: KEK.key.toString("base64"),
};

function capture() {
  const lines = [];
  return { lines, out: (line) => lines.push(String(line)), err: (line) => lines.push(String(line)) };
}

async function run(command, argv, { authors = [adminId] } = {}) {
  const log = capture();
  // A measure is proved by a code (ADR-262 §5); the database accepts each step once, so
  // the test clears `last_step` before it asks for the next one.
  const args = [...argv];
  if (command !== "list") {
    for (const author of authors) {
      await store.pool.query("update user_mfa set last_step = null where user_id = $1", [author]);
    }
    args.push("--code", totpCode(SECRET, totpStep()));
  }
  const code = await runAbuse({
    command,
    argv: args,
    env,
    store,
    mailConfig,
    out: log.out,
    err: log.err,
  });
  return { code, text: log.lines.join("\n") };
}

async function seed() {
  for (const [id, email, lang] of [
    [adminId, `admin-${orgId}@example.test`, "en"],
    [memberId, `member-${orgId}@example.test`, "ru"],
  ]) {
    await store.pool.query(
      `insert into users (id, email, password_hash, name, handle, lang, email_verified_at)
       values ($1, $2, 'x', 'Person', $3, $4, now())`,
      [id, email, `person-${id.slice(0, 8)}`, lang],
    );
  }
  // The administrator holds the operator role in this fixture: every measure names its
  // author and the role is checked (ADR-259 amendment).
  await store.pool.query("insert into instance_operators (user_id) values ($1)", [adminId]);
  const sealed = encryptSecret(SECRET, {
    scope: "mfa",
    scopeId: adminId,
    provider: "totp",
    id: adminId,
    kek: KEK,
  });
  await store.pool.query(
    `insert into user_mfa
       (user_id, secret_ciphertext, secret_nonce, secret_dek_wrapped, secret_dek_nonce,
        kek_id, confirmed_at)
     values ($1, $2, $3, $4, $5, $6, now())`,
    [adminId, sealed.ciphertext, sealed.nonce, sealed.dekWrapped, sealed.dekNonce, sealed.kekId],
  );
  await store.pool.query("insert into orgs (id, name, slug) values ($1, 'Abuse org', $2)", [
    orgId,
    `abuse-org-${orgId}`,
  ]);
  await store.pool.query(
    `insert into org_memberships (org_id, user_id, relation, state)
     values ($1, $2, 'member', 'active'), ($1, $3, 'member', 'active')`,
    [orgId, adminId, memberId],
  );
  await store.pool.query(
    "insert into admin_roles (org_id, user_id, role) values ($1, $2, 'org_admin')",
    [orgId, adminId],
  );
  await store.pool.query(
    `insert into boards (id, title, org_id, owner_id, visibility)
     values ($1, 'A room affected by a complaint', $2, $3, 'link')`,
    [boardId, orgId, adminId],
  );
  await store.pool.query(
    "insert into board_links (board_id, enabled) values ($1, true)",
    [boardId],
  );
  // The member reaches the room through an organisation grant, not the public link.
  await store.pool.query(
    `insert into board_grants (board_id, subject_type, subject_id, role)
     values ($1, 'org', $2, 'viewer')`,
    [boardId, orgId],
  );
}

async function access(userId) {
  return store.withTenant(orgId, () =>
    accessForBoard({ store, boardId, userId, unlockToken: null }),
  );
}

describe.skipIf(!store)("abuse measures (ADR-259)", () => {
  beforeAll(async () => {
    await seed();
  });

  afterAll(async () => {
    if (!store) return;
    await store.pool.query("delete from operator_actions where subject_id = $1 or subject_id = $2", [
      boardId,
      orgId,
    ]);
    await store.pool.query("delete from mail_outbox where to_email like $1", [`%${orgId}@example.test`]);
    await store.pool.query("delete from audit_events where org_id = $1", [orgId]);
    await store.pool.query("delete from board_grants where board_id = $1", [boardId]);
    await store.pool.query("delete from board_links where board_id = $1", [boardId]);
    await store.pool.query("delete from boards where id = $1", [boardId]);
    await store.pool.query("delete from admin_roles where org_id = $1", [orgId]);
    await store.pool.query("delete from org_memberships where org_id = $1", [orgId]);
    await store.pool.query("delete from orgs where id = $1", [orgId]);
    await store.pool.query("delete from user_mfa where user_id = $1", [adminId]);
    await store.pool.query("delete from instance_operators where user_id = $1", [adminId]);
    await store.pool.query("delete from users where id = any($1::uuid[])", [[adminId, memberId]]);
    await store.close();
  });

  it("refuses a measure that does not name its author", async () => {
    const log = capture();
    const code = await runAbuse({
      command: "link-disable",
      argv: [
        "--link",
        boardId,
        "--reason",
        "unnamed",
        "--public",
        "unnamed",
      ],
      env: {},
      store,
      mailConfig,
      out: log.out,
      err: log.err,
    });
    expect(code).toBe(1);
    expect(log.lines.join("\n")).toContain("--as");
    const { rows } = await store.pool.query(
      "select 1 from operator_actions where subject_id = $1",
      [boardId],
    );
    expect(rows).toHaveLength(0);
  });

  it("disables a link for visitors, keeps members in, and reverts both", async () => {
    const before = await access(null);
    expect(before.access.allowed).toBe(true);
    expect(before.access.sources).toEqual(["link"]);

    const disabled = await run("link-disable", [
      "--link",
      boardId,
      "--reason",
      "the link pointed at prohibited material",
      "--public",
      "The link was turned off after a complaint.",
      "--report",
      "R-42",
      "--as",
      adminId,
    ]);
    expect(disabled.code).toBe(0);

    const visitor = await access(null);
    expect(visitor.access.allowed).toBe(false);
    expect(visitor.linkInactive).toBe(true);

    const member = await access(memberId);
    expect(member.access.allowed).toBe(true);
    expect(member.access.notice).toEqual({
      kind: "link_disable",
      reason: "The link was turned off after a complaint.",
    });

    const { rows: actions } = await store.pool.query(
      "select id, kind, reverted_at from operator_actions where subject_id = $1",
      [boardId],
    );
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ kind: "link_disable", reverted_at: null });
    actionIds.push(actions[0].id);

    const { rows: mail } = await store.pool.query(
      "select template, to_email, locale from mail_outbox where to_email = $1",
      [`admin-${orgId}@example.test`],
    );
    expect(mail).toEqual([
      { template: "operator_action", to_email: `admin-${orgId}@example.test`, locale: "en" },
    ]);

    const reverted = await run("revert", [
      actions[0].id,
      "--reason",
      "the complaint was withdrawn",
      "--as",
      adminId,
    ]);
    expect(reverted.code).toBe(0);
    const after = await access(null);
    expect(after.access.allowed).toBe(true);
    expect(after.access.notice).toBeUndefined();
  });

  it("hides a room from everyone but the organisation's administrators", async () => {
    const hidden = await run("board-hide", [
      "--board",
      boardId,
      "--reason",
      "pending investigation",
      "--public",
      "The room is hidden while we look into a complaint.",
      "--as",
      adminId,
    ]);
    expect(hidden.code, hidden.text).toBe(0);

    const member = await access(memberId);
    expect(member.access.allowed).toBe(false);
    const admin = await access(adminId);
    expect(admin.access.allowed).toBe(true);
    expect(admin.access.notice?.kind).toBe("board_hide");

    const { rows } = await store.pool.query(
      "select id from operator_actions where subject_id = $1 and reverted_at is null",
      [boardId],
    );
    expect(rows).toHaveLength(1);
    const reverted = await run("revert", [
      rows[0].id,
      "--reason",
      "investigation closed",
      "--as",
      adminId,
    ]);
    expect(reverted.code).toBe(0);
    expect((await access(memberId)).access.allowed).toBe(true);
  });

  it("suspends the organisation, answers ORG_SUSPENDED and restores it", async () => {
    const suspended = await run("org-suspend", [
      "--org",
      orgId,
      "--reason",
      "repeated infringement",
      "--public",
      "The organisation is suspended after repeated complaints.",
      "--as",
      adminId,
    ]);
    expect(suspended.code, suspended.text).toBe(0);

    const admin = await access(adminId);
    expect(admin.access.allowed).toBe(false);
    expect(admin.access.reason).toBe("ORG_SUSPENDED");
    expect(admin.orgSuspended).toBe(true);
    expect(admin.isOrgAdmin).toBe(true);

    const { rows: org } = await store.pool.query(
      "select suspended_at, suspension_ref from orgs where id = $1",
      [orgId],
    );
    expect(org[0].suspended_at).not.toBeNull();

    const { rows: actions } = await store.pool.query(
      "select id from operator_actions where kind = 'org_suspend' and reverted_at is null",
    );
    const reverted = await run("revert", [
      actions[0].id,
      "--reason",
      "appeal accepted",
      "--as",
      adminId,
    ]);
    expect(reverted.code).toBe(0);
    const { rows: restored } = await store.pool.query(
      "select suspended_at, suspension_ref from orgs where id = $1",
      [orgId],
    );
    expect(restored[0]).toEqual({ suspended_at: null, suspension_ref: null });
    expect((await access(adminId)).access.allowed).toBe(true);
  });

  it("lists open and closed measures with their reasons", async () => {
    const list = await run("list", []);
    expect(list.code).toBe(0);
    expect(list.text).toContain("org_suspend");
    expect(list.text).toContain("reverted");
  });
});
