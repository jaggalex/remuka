// Explicit allowlist. Adding secret or provider payload columns to the database must not expose them.
export const journalColumns = [
  "id", "org_id", "seq", "prev_hash", "hash", "agent_id", "task_id", "owner_id", "board_id",
  "skill", "skill_version", "capabilities", "acl_version", "provider", "model", "credential_id",
  "key_fingerprint", "gateway_provider", "temperature", "max_tokens", "toolset", "prompt_hash",
  "input_object_ids", "prompt_tokens", "completion_tokens", "cost_usd", "latency_ms", "status",
  "error_code", "error_message", "request_id", "started_at", "finished_at",
];

function cell(value) {
  if (value == null) return "";
  if (value instanceof Date) value = value.toISOString();
  if (Array.isArray(value)) value = JSON.stringify(value);
  let text = String(value);
  // Quoting alone does not prevent spreadsheet programs from evaluating a cell.
  if (typeof value === "string" && /^\s*[=+@-]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

export async function* journalCsv(store, orgId, through) {
  yield journalColumns.join(",") + "\r\n";
  for (let after = "0"; BigInt(after) < BigInt(through);) {
    const rows = await store.aiJournalPage(orgId, after, through);
    if (!rows.length) throw Error("AI journal ended before the requested sequence");
    for (const row of rows) yield journalColumns.map(column => cell(row[column])).join(",") + "\r\n";
    after = String(rows.at(-1).seq);
  }
}
