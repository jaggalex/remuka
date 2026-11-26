import fs from "node:fs";
import { slotRules, hintDefaults } from "../apps/web/src/hintSlots.ts";

const slots = slotRules.map(({ variants, ...rule }) => ({
  ...rule,
  fields: Object.keys(rule.maxLength),
  defaults: Object.fromEntries(["ru", "en"].map(lang => [lang, variants.map(variant => ({
    key: variant.key, intent: variant.intent, enabled: true,
    fields: {
      ...(variant.title ? { title: hintDefaults[variant.title[0]][lang] + " **" + hintDefaults[variant.title[1]][lang] + "**" } : {}),
      body: hintDefaults[variant.body][lang],
    },
  }))])),
}));
const path = new URL("../content/hints/slots.json", import.meta.url);
const output = JSON.stringify(slots, null, 2) + "\n";
if (process.argv.includes("--check")) {
  if (!fs.existsSync(path) || fs.readFileSync(path, "utf8") !== output) throw new Error("Run pnpm hints:slots");
} else {
  fs.mkdirSync(new URL(".", path), { recursive: true });
  fs.writeFileSync(path, output);
}
console.log("hints: " + slots.length + " slots, RU/EN");
