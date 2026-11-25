import type { TranslationKey } from "./i18n";

/**
 * Which greeting the team home opens with.
 *
 * The mockup shows "Доброе утро, Аня"; a product that says that at midnight is the system
 * talking, not a colleague (ADR-265 §2). The three phrases are separate keys, not a
 * concatenated "Доброе " + part, because English would need a different sentence.
 */
export function greetingKey(hour: number): TranslationKey {
  if (hour < 12) return "home.greeting.morning";
  if (hour < 18) return "home.greeting.day";
  return "home.greeting.evening";
}
