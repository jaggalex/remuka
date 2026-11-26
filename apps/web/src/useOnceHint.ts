import { useEffect, useState, useSyncExternalStore } from "react";
import { useI18n } from "./i18n";
import { countHint } from "./hintCatalog";
import { hintVariant, type HintContext, type HintId } from "./hintRegistry";
import { beginHintVisit, currentHintVisit, hintLearned, subscribeHints } from "./hints";

/**
 * "Show this until the person has learned it" (ADR-266 §6, ADR-289).
 *
 * Returns whether the plate should be on screen now. `active` is where the hint could
 * be seen at all (a room with objects, no voting line): a visit that had nothing to
 * talk about does not count. The action itself calls `markHintDone` in its handler.
 */
export function useOnceHint(id: HintId, { active = true, ...context }: HintContext & { active?: boolean } = {}) {
  const { hints, hintsReady } = useI18n();
  const disabled = (hints[id] ?? []).filter(v => !v.enabled).map(v => v.key);
  const show = useSyncExternalStore(
    subscribeHints,
    () => !hintLearned(id),
    () => false,
  );

  const visit = useSyncExternalStore(subscribeHints, () => currentHintVisit(id), () => 0);
  useEffect(() => {
    if (active) beginHintVisit(id, visit);
  }, [id, active, visit]);

  const [choice, setChoice] = useState<{
    id: HintId; visit: number; variant: ReturnType<typeof hintVariant>;
  } | null>(null);
  // Keep reading possible when someone enters or leaves. Replace only a variant
  // that no longer applies, for example an invitation when a teammate arrives.
  const keep = choice?.id === id && choice.visit === visit && !disabled.includes(choice.variant.intent) && (choice.variant.when?.(context) ?? true);
  const variant = keep ? choice.variant : hintVariant(id, visit, context, disabled);
  useEffect(() => {
    if (active) setChoice({ id, visit, variant });
  }, [active, id, visit, variant]);

  useEffect(() => { if (hintsReady && active && show) countHint("hint.shown", id, variant.intent); }, [hintsReady, active, show, id, variant]);
  return { show: active && show, variant };
}
