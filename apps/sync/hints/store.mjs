import { catalogSlot, languages, validateVariants } from "./catalog.mjs";

function conflict() {
  const error = new Error("The draft has changed. Reload it before saving.");
  error.code = "conflict";
  throw error;
}
const versionRows = (client, id, lang) => client.query(
  `select status, version, variant_key as key, intent, enabled, fields, updated_at
     from hint_texts where slot_id=$1 and lang=$2 order by version desc, variant_key`, [id, lang]);
function state(rows, slot, lang) {
  const groups = new Map();
  for (const r of rows) {
    const key = r.status + ":" + r.version;
    if (!groups.has(key)) groups.set(key, { status: r.status, version: r.version, variants: [] });
    groups.get(key).variants.push({ key: r.key, intent: r.intent, enabled: r.enabled, fields: r.fields });
  }
  const all = [...groups.values()];
  const defaults = { version: 0, variants: slot.defaults[lang] };
  const history = [...all.filter(v => v.status === "published"), defaults];
  return { draft: all.find(v => v.status === "draft") ?? null, published: history[0], history };
}

export async function slotState(client, slot, lang) {
  return state((await versionRows(client, slot.id, lang)).rows, slot, lang);
}

export async function publishedWords(client, lang) {
  const { rows } = await client.query(`select t.slot_id, t.variant_key as key, t.intent, t.fields, t.enabled, t.version
    from hint_texts t join (
      select slot_id, max(version) as version from hint_texts where lang=$1 and status='published' group by slot_id
    ) p on t.slot_id=p.slot_id and t.version=p.version
    where t.lang=$1 and t.status='published' order by t.slot_id,t.variant_key`, [lang]);
  const result = {};
  for (const { slot_id, ...row } of rows) (result[slot_id] ??= []).push(row);
  return result;
}

export async function writeWords(client, { id, lang, action, body, operator, sessionId, mfa }) {
  const slot = catalogSlot(id);
  if (!slot || !languages.includes(lang)) throw new Error("Unknown slot");
  await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", ["words:" + lang + ":" + id]);
  const before = await slotState(client, slot, lang);
  const latest = Math.max(before.draft?.version ?? 0, before.published.version);
  if (body.expected !== latest) conflict();
  const version = latest + 1;
  let source;
  if (action === "draft") source = body.variants;
  else if (action === "publish") source = before.draft?.variants;
  else if (action === "rollback") source = before.history[1]?.variants;
  if (!source) conflict();
  const checked = validateVariants(slot, lang, source);
  const publication = action !== "draft";
  if (publication && (!body.reason?.trim?.() || body.reason.length > 500)) {
    const error = new Error("Give a reason of up to 500 characters");
    error.code = "reason";
    throw error;
  }
  await client.query("delete from hint_texts where slot_id=$1 and lang=$2 and status='draft'", [id, lang]);
  for (const row of checked.variants) {
    await client.query(`insert into hint_texts
      (slot_id,lang,variant_key,intent,fields,enabled,status,version,updated_by)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [id, lang, row.key, row.intent, row.fields,
      row.enabled, publication ? "published" : "draft", version, operator]);
  }
  if (publication) {
    await client.query(`insert into audit_events(actor_id,session_id,action,subject,reason,channel,mfa,after)
      values($1,$2,'hint.published',$3,$4,'console',$5,$6)`,
    [operator,sessionId,id,body.reason.trim(),mfa,{ version, lang, action }]);
  }
  return { version, warnings: checked.warnings };
}

export async function saveWords(pool, input) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await writeWords(client, input);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally { client.release(); }
}
