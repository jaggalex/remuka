import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { expect, type TestInfo } from "@playwright/test";
import { Pool } from "pg";
import { E2E_DATABASE_URL } from "../../e2e/ports";

/** A second installation has its own marked test database and an independent operator. */
export async function checkTransfer(info: TestInfo, expected: string) {
  const token = "words_" + randomBytes(6).toString("hex");
  const name = "remo_test_e2e_" + token;
  const target = new URL(E2E_DATABASE_URL);
  target.pathname = "/" + name;
  const env = { ...process.env, REMO_E2E_DATABASE_NAME: name, REMO_E2E_RUN_ID: token };
  const lifecycle = (...args: string[]) => execFileSync(process.execPath, ["scripts/e2e-db.mjs", ...args], { env });
  const file = info.outputPath("published-words.json");
  const transfer = (db: string, ...args: string[]) => execFileSync(process.execPath,
    ["scripts/hint-transfer.mjs", ...args], { env: { ...env, DATABASE_URL: db } });
  const pool = new Pool({ connectionString: target.href });
  lifecycle();
  try {
    execFileSync(process.execPath, ["scripts/db-check.mjs"], { env: { ...env, DATABASE_URL: target.href, REMO_MIGRATION_DATABASE_URL: target.href } });
    const id = randomUUID();
    const email = id + "@example.test";
    await pool.query("insert into users(id,email,password_hash,name,handle) values($1,$2,'unused','Editor',$3)", [id,email,"words-"+id.slice(0,8)]);
    await pool.query("insert into instance_operators(user_id) values($1)", [id]);
    const revisions = (status: string) => pool.query(
      "select fields->>'body' as body from hint_texts where slot_id='room.empty' and lang='en' and variant_key='action' and status=$1",[status]);
    expect((await revisions("published")).rowCount).toBe(0);
    transfer(E2E_DATABASE_URL, "export", file);
    transfer(target.href, "import", file, email);
    transfer(target.href, "import", file, email);
    expect((await revisions("draft")).rows).toEqual([{ body: expected }]);
    expect((await revisions("published")).rowCount).toBe(0);
  } finally {
    try { await pool.end(); } finally { lifecycle("--teardown"); }
  }
}
