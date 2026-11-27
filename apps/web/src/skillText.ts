import type { TranslationKey } from "./i18n";

/** Short, translated descriptions for the built-in skills. */
const KEYS: Record<string, TranslationKey> = {
  "brief-to-board": "agents.skill.brief-to-board.description",
  diagram: "agents.skill.diagram.description",
  cards: "agents.skill.cards.description",
  "tidy-selection": "agents.skill.tidy-selection.description",
};

export function skillDescriptionKey(slug: string): TranslationKey | null {
  return KEYS[slug] ?? null;
}

/** User-defined skills keep the display name supplied by the organisation. */
export function skillNameKey(slug: string): TranslationKey | null {
  return KEYS[slug] ? `agents.skill.${slug}.name` as TranslationKey : null;
}
