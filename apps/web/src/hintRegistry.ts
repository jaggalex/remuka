import type { TranslationKey } from "./i18n";

interface HintContext {
  canInvite?: boolean;
  hasPeers?: boolean;
}

interface HintVariant {
  intent: "action" | "benefit" | "together";
  key: TranslationKey;
  title?: readonly [TranslationKey, TranslationKey];
  when?: (context: HintContext) => boolean;
}

interface HintDefinition {
  id: string;
  variants: readonly [HintVariant, ...HintVariant[]];
  /** Only instructional plates retire. An empty screen always needs a heading. */
  doneAfter?: number;
  maxSessions?: number;
  legacyKey?: string;
}

export const HINT_REGISTRY = [
  {
    id: "canvas.doubleClickEdit",
    variants: [
      { intent: "action", key: "canvas.hint" },
      { intent: "benefit", key: "canvas.hintBenefit" },
    ],
    doneAfter: 3,
    maxSessions: 5,
    legacyKey: "remo.canvas.hint",
  },
  {
    id: "sticky.series",
    variants: [
      { intent: "action", key: "tool.seriesHint" },
      { intent: "benefit", key: "tool.seriesBenefit" },
    ],
    doneAfter: 2,
    maxSessions: 5,
  },
  { id: "home.quiet", variants: [
    { intent: "action", key: "home.leadEmpty" }, { intent: "together", key: "news.quietAlt" },
  ] },
  {
    id: "room.empty",
    variants: [
      { intent: "action", key: "empty.body", title: ["empty.titleBefore", "empty.titleMark"] },
      { intent: "benefit", key: "empty.benefitBody", title: ["empty.benefitBefore", "empty.benefitMark"] },
      { intent: "together", key: "empty.inviteBody", title: ["empty.inviteBefore", "empty.inviteMark"],
        when: ({ canInvite, hasPeers }) => Boolean(canInvite && !hasPeers) },
    ],
  },
] as const satisfies readonly HintDefinition[];

export type HintId = (typeof HINT_REGISTRY)[number]["id"];
export type { HintContext };

export function hintDefinition(id: HintId): HintDefinition {
  return HINT_REGISTRY.find((hint) => hint.id === id)!;
}

/** Visits are zero-based. Each slot keeps an unconditional default. */
export function hintVariant(id: HintId, visit: number, context: HintContext = {}, disabled: string[] = []): HintVariant {
  const { variants } = hintDefinition(id);
  const eligible = variants.filter((variant) => !disabled.includes(variant.intent) && (!variant.when || variant.when(context)));
  return eligible[visit % eligible.length] ?? variants[0];
}
