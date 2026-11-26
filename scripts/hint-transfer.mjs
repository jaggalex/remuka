import { readFile, writeFile } from "node:fs/promises";
import pg from "pg";
import { resolveDatabaseUrl } from "../apps/sync/postgres.mjs";
import { exportWords, importDrafts } from "../apps/sync/hints/transfer.mjs";

const [action, file, operatorEmail] = process.argv.slice(2);
if (!file || !["export","import"].includes(action) || (action === "import" && !operatorEmail)) {
  throw new Error("Usage: pnpm hints:export <file> | pnpm hints:import <file> <operator-email>");
}
const connectionString = await resolveDatabaseUrl();
if (!connectionString) throw new Error("Choose the installation with DATABASE_URL");
const pool = new pg.Pool({ connectionString, max: 1 });
try {
  if (action === "export") {
    const client = await pool.connect();
    try {
      await client.query("begin isolation level repeatable read read only");
      const data = await exportWords(client);
      await client.query("commit");
      await writeFile(file, JSON.stringify(data, null, 2) + "\n", { flag: "wx" });
      console.log("Exported " + data.entries.length + " slot/language pairs");
    } finally { client.release(); }
  } else {
    const result = await pool.query("select u.id from users u join instance_operators i on i.user_id=u.id where lower(u.email)=lower($1) and u.state='active'", [operatorEmail]);
    if (!result.rowCount) throw new Error("An active installation operator is required");
    const input = JSON.parse(await readFile(file, "utf8"));
    await importDrafts(pool, input, result.rows[0].id);
    console.log("Imported drafts for review in Words");
  }
} finally { await pool.end(); }
