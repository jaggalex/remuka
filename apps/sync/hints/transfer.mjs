import { isDeepStrictEqual } from "node:util";
import { catalogSlot, languages, slots, validateVariants } from "./catalog.mjs";
import { slotState, writeWords } from "./store.mjs";

/** The portable format contains approved wording only. Operator and audit ids stay local. */
export async function exportWords(client) {
  const entries = [];
  for (const slot of slots) {
    for (const lang of languages) {
      const { published } = await slotState(client, slot, lang);
      entries.push({ slot: slot.id, lang, variants: published.variants });
    }
  }
  return { format: 1, entries };
}

export async function importDrafts(pool, input, operator) {
  if (input?.format !== 1 || !Array.isArray(input.entries) || input.entries.length > slots.length * languages.length) {
    throw new Error("Unknown hint export format");
  }
  const seen = new Set();
  const entries = input.entries.map(row => {
    const slot = catalogSlot(row.slot);
    const { variants } = validateVariants(slot, row.lang, row.variants);
    const key = row.slot + ":" + row.lang;
    if (seen.has(key)) throw new Error("Duplicate entry: " + key);
    seen.add(key);
    return { slot, lang: row.lang, variants, key };
  }).sort((a, b) => a.key.localeCompare(b.key));
  const client = await pool.connect();
  try {
    await client.query("begin");
    for (const { slot, lang, variants } of entries) {
      const state = await slotState(client, slot, lang);
      // An import never silently replaces an operator's unsaved publication work.
      if (state.draft) {
        const byKey = (a,b) => a.key.localeCompare(b.key);
        if (!isDeepStrictEqual(state.draft.variants.toSorted(byKey), variants.toSorted(byKey))) throw new Error("A different draft exists: " + slot.id + "/" + lang);
        continue;
      }
      await writeWords(client, { id: slot.id, lang, action: "draft", operator,
        body: { variants, expected: state.published.version } });
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally { client.release(); }
}
