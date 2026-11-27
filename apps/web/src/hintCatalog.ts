import { useEffect, useState } from "react";
import { call } from "./apiCall";
import { slotRules } from "./hintSlots";

export type HintLocale = "ru" | "en";
export interface WordVariant {
  key: string;
  intent: string;
  enabled: boolean;
  fields: Record<string, string>;
}
export type Catalog = Record<string, WordVariant[]>;
// One request per language per page load. An operator update must not change text mid-visit.
const visits = new Map<HintLocale, Promise<Catalog>>();
export const emptyCatalog: Catalog = {};
export function useHintCatalog(lang: HintLocale) {
  const [state, setState] = useState<{ lang: HintLocale; words: Catalog }>();
  useEffect(() => {
    let current = true;
    let request = visits.get(lang);
    if (!request) {
      request = call<{ words: Catalog }>("/hints?lang=" + lang).then(result => result.words).catch(() => emptyCatalog);
      visits.set(lang, request);
    }
    void request.then(words => { if (current) setState({ lang, words }); });
    return () => { current = false; };
  }, [lang]);
  return state?.lang === lang ? state.words : null;
}

export function catalogueStrings(words: Catalog): Record<string, string> {
  const overrides: Record<string, string> = {};
  for (const slot of slotRules) {
    for (const v of words[slot.id] ?? []) {
      const rule = slot.variants.find(variant => variant.key === v.key);
      if (!rule || typeof v.fields?.body !== "string") continue;
      overrides[rule.body] = v.fields.body;
      if ("title" in rule && typeof v.fields.title === "string") {
        const [first, mark] = v.fields.title.split("**");
        overrides[rule.title[0]] = (first ?? "").trim();
        overrides[rule.title[1]] = mark ?? "";
      }
    }
  }
  return overrides;
}

const counted = new Set<string>();
const seen = new Map<string, string>();
export function countHint(name: "hint.shown" | "hint.acted", slot: string, variant: string) {
  const key = [name, slot, variant].join("/");
  if (counted.has(key) || typeof window === "undefined") return;
  counted.add(key);
  if (name === "hint.shown") seen.set(slot, variant);
  void call("/hints/event", { method: "POST", keepalive: true, body: { name, slot, variant } }).catch(() => {});
}
export function actedOnHint(slot: string) {
  const variant = seen.get(slot);
  if (variant) countHint("hint.acted", slot, variant);
}
