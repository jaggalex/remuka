import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const local = new URL("../../../content/hints/slots.json", import.meta.url);
const image = new URL("../content/hints/slots.json", import.meta.url);
export const slots = JSON.parse(readFileSync(existsSync(local) ? local : image, "utf8"));
export const catalogSlot = (id) => slots.find(slot => slot.id === id);
export const languages = ["ru", "en"];
const reasons = {
  unknown: "Unknown slot, language or variant", fields: "Use only the fields of this slot",
  length: "The field is empty or too long", html: "HTML is not allowed", link: "Links are not allowed",
  placeholder: "Unrecognised or incomplete placeholder", emoji: "Remove emoji",
  voice: "Replace the prohibited expression", bold: "This field accepts plain text",
  enabled: "Keep at least one unconditional variant enabled",
};
export function invalid(code, field = "") {
  const error = new Error(reasons[code] ?? code);
  error.code = code;
  error.field = field;
  throw error;
}
export function validateVariants(slot, lang, variants) {
  if (!slot || !languages.includes(lang) || !Array.isArray(variants)) invalid("unknown");
  const base = slot.defaults[lang];
  const byKey = new Map(variants.map(row => [row?.key, row]));
  if (byKey.size !== base.length || variants.length !== base.length) invalid("unknown");
  const warnings = [];
  const result = base.map(original => {
    const input = byKey.get(original.key);
    if (!input || typeof input.enabled !== "boolean") invalid("unknown");
    if (!input.fields || Object.keys(input.fields).sort().join() !== [...slot.fields].sort().join()) invalid("fields");
    const fields = {};
    for (const field of slot.fields) {
      const path = original.key + "." + field;
      const value = input.fields[field];
      if (typeof value !== "string" || !value.trim() || Array.from(value).length > slot.maxLength[field]) invalid("length", path);
      if (/[<>]/.test(value)) invalid("html", path);
      if (/(?:\b(?:https?|ftp|mailto|tel):|www\.|\]\(|(?:[\p{L}\d-]+\.)+[\p{L}]{2,}(?:[/#:?]|\s|$))/iu.test(value)) invalid("link", path);
      const rest = value.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (_, key) => {
        if (!slot.placeholders.includes(key)) invalid("placeholder", path);
        return "";
      });
      if (/[{}]/.test(rest)) invalid("placeholder", path);
      if (/\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u.test(value)) invalid("emoji", path);
      if (/осуществить|данный|в целях|произвести|в случае если|успешно|функционал|что-то пошло не так|something went wrong|oops|упс!/iu.test(value)) invalid("voice", path);
      if (value.includes("*") && (!slot.bold || field !== "title" || !/^[^*]*\*\*[^*]+\*\*$/.test(value))) invalid("bold", path);
      if (/холстик|борда|воркспейс|воркспэйс/iu.test(value)) warnings.push({ field: path, code: "glossary" });
      fields[field] = value.trim();
    }
    return { key: original.key, intent: original.intent, enabled: input.enabled, fields };
  });
  if (!result.some(row => row.enabled && !(slot.id === "room.empty" && row.intent === "together"))) invalid("enabled");
  return { variants: result, warnings };
}
export const entityTag = value => '"' + createHash("sha256").update(JSON.stringify(value)).digest("hex") + '"';
