/**
 * The words that come from data rather than from a sentence (ADR-255 §6).
 *
 * `@remo/consent` names categories and lifetimes as data; the interface shows them in
 * both languages. This module is the one bridge: a category or a lifetime without a key
 * fails the test beside it, so a new registry record cannot reach the page untranslated.
 */
import type { ConsentCategory } from "@remo/consent";
import type { TranslationKey } from "./i18n";

/** One title per category the registry may use. */
export const CATEGORY_KEYS: Readonly<Record<ConsentCategory, TranslationKey>> = {
  necessary: "consent.category.necessary",
  preferences: "consent.category.preferences",
  analytics: "consent.category.analytics",
  marketing: "consent.category.marketing",
};

/** One explanation per category, used under the switch. */
export const CATEGORY_HINT_KEYS: Readonly<Record<ConsentCategory, TranslationKey>> = {
  necessary: "consent.category.necessary.hint",
  preferences: "consent.category.preferences.hint",
  analytics: "consent.category.analytics.hint",
  marketing: "consent.category.marketing.hint",
};

/**
 * The registry's lifetime strings in words.
 *
 * The registry carries the lifetime as one string because the server and the policy page
 * must read the same value; the interface translates that value rather than keeping a
 * second lifetime table. `consentClient.test.ts` fails when a registry lifetime is missing
 * here.
 */
export const LIFETIME_KEYS: Readonly<Record<string, TranslationKey>> = {
  "30 days": "consent.lifetime.days30",
  "12 hours": "consent.lifetime.hours12",
  "1 year": "consent.lifetime.year1",
  "6 months (EU) / 12 months (Russia)": "consent.lifetime.consentChoice",
  "until cleared": "consent.lifetime.untilCleared",
  "browser session": "consent.lifetime.session",
};

/** The translated key for a registry lifetime, or the value itself when it has none. */
export function lifetimeKey(value: string): TranslationKey | null {
  return LIFETIME_KEYS[value] ?? null;
}
