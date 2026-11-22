import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runOperatorRole } from "./operator-role.mjs";
import { testDatabaseStore } from "./test-db.mjs";

/**
 * The role command against a real database (ADR-259, `spec/operator.md` §2, §9).
 *
 * A confirmed address can hold the role; an unconfirmed one cannot. Every command names
 * its author with `--as`, the role is checked, and a revoke removes it, re-granting is
 * idempotent, and every change leaves a reason in the journal.
 */
const opened = await testDatabaseStore("operator-role");
const store = opened?.store ?? null;

const users = [];
let lead = null;

async function seedUser({ verified = true } = {}) {
  const id = randomUUID();
  const email = `role-${id}@example.test`;
  await store.pool.query(
    `insert into users (id, email, password_hash, name, handle, email_verified_at)
     values ($1, $2, 'x', 'Operator', $3, $4)`,
    [id, email, `role-${id.slice(0, 8)}`, verified ? new Date() : null],
  );
  users.push(id);
  return { id, email };
}

function capture() {
  const lines = [];
  return { lines, out: (line) => lines.push(String(line)), err: (line) => lines.push(String(line)) };
}

async function run(command, argv) {
  const log = capture();
  const code = await runOperatorRole({ command, argv, store, out: log.out, err: log.err });
  return { code, text: log.lines.join("\n") };
}

describe.skipIf(!store)("operator role (ADR-259)", () => {
  beforeAll(async () => {
    // The suite needs one operator before the first `--as` can resolve. The real
    // bootstrap is covered by the unit test: with no holders the account names itself.
    lead = await seedUser();
    await store.pool.query("insert into instance_operators (user_id) values ($1)", [lead.id]);
  });

  afterAll(async () => {
    if (!store) return;
    await store.pool.query("delete from audit_events where subject = any($1::text[])", [users]);
    await store.pool.query("delete from instance_operators where user_id = any($1::uuid[])", [users]);
    await store.pool.query("delete from users where id = any($1::uuid[])", [users]);
    await store.close();
  });

  it("refuses an unconfirmed address", async () => {
    const person = await seedUser({ verified: false });
    const result = await run("grant", [
      "--email", person.email,
      "--reason", "bootstrap",
      "--as", lead.email,
    ]);
    expect(result.code).toBe(1);
    expect(result.text).toContain("no confirmed address");
    const { rows } = await store.pool.query(
      "select 1 from instance_operators where user_id = $1",
      [person.id],
    );
    expect(rows).toHaveLength(0);
  });

  it("refuses a command that does not name its author", async () => {
    const person = await seedUser();
    const result = await runOperatorRole({
      command: "grant",
      argv: ["--email", person.email, "--reason", "bootstrap"],
      env: {},
      store,
      out: () => {},
      err: () => {},
    });
    expect(result).toBe(1);
    expect(await store.isInstanceOperator(person.id)).toBe(false);
  });

  it("grants a confirmed address, records the author and revokes it", async () => {
    const first = await seedUser();
    const second = await seedUser();

    const granted = await run("grant", [
      "--email", first.email,
      "--reason", "bootstrap",
      "--as", lead.email,
    ]);
    expect(granted.code).toBe(0);
    expect(await store.isInstanceOperator(first.id)).toBe(true);

    await run("grant", ["--email", second.email, "--reason", "second operator", "--as", lead.email]);
    const revoked = await run("revoke", [
      "--email", first.email,
      "--reason", "left the team",
      "--as", second.email,
    ]);
    expect(revoked.code).toBe(0);
    expect(await store.isInstanceOperator(first.id)).toBe(false);

    const { rows } = await store.pool.query(
      `select action, reason, actor_id from audit_events
        where subject = any($1::text[])
        order by id`,
      [users],
    );
    expect(rows.map((row) => row.action)).toEqual([
      "operator.granted",
      "operator.granted",
      "operator.revoked",
    ]);
    expect(rows.map((row) => row.reason)).toEqual([
      "bootstrap",
      "second operator",
      "left the team",
    ]);
    expect(rows.map((row) => row.actor_id)).toEqual([lead.id, lead.id, second.id]);
  });

  it("is idempotent and lists the role with its grant date", async () => {
    const person = await seedUser();
    await run("grant", ["--email", person.email, "--reason", "first", "--as", lead.email]);
    await run("grant", ["--email", person.email, "--reason", "again", "--as", lead.email]);

    const { rows } = await store.pool.query(
      "select count(*)::int as n from instance_operators where user_id = $1",
      [person.id],
    );
    expect(rows[0].n).toBe(1);

    const listed = await run("list", []);
    expect(listed.code).toBe(0);
    expect(listed.text).toContain(person.email);
  });
});
