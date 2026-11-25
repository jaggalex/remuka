import type { TranslationKey } from "./i18n";

/**
 * Every "until you've learned it" hint, in code (ADR-266 §6, ADR-289).
 *
 * The list is the single source of a hint's text key and of how quickly it goes away.
 * T16 turns these slots into editable texts on the server; it must keep using this
 * registry rather than adding a second list beside it.
 */
export interface HintDefinition {
  id: string;
  /** The sentence the plate shows, through i18n (RU and EN). */
  text: TranslationKey;
  /** The action counts as learned after this many uses. */
  doneAfter: number;
  /** A hint nobody used also goes away after this many visits. */
  maxSessions: number;
  /**
   * The old one-visit browser key, kept so people who already dismissed the plate
   * before this mechanism existed do not see it again (ADR-289).
   */
  legacyKey?: string;
}

export const HINT_REGISTRY = [
  {
    id: "canvas.doubleClickEdit",
    text: "canvas.hint",
    doneAfter: 3,
    maxSessions: 5,
    legacyKey: "remo.canvas.hint",
  },
] as const satisfies readonly HintDefinition[];

export type HintId = (typeof HINT_REGISTRY)[number]["id"];

export function hintDefinition(id: HintId): HintDefinition {
  return HINT_REGISTRY.find((hint) => hint.id === id)!;
}
