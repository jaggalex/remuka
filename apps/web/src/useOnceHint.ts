import { useEffect, useSyncExternalStore } from "react";
import { hintDefinition, type HintId } from "./hintRegistry";
import { hintLearned, markHintVisit, subscribeHints } from "./hints";

/**
 * Counts visits once per page load, not once per mounted component: two plates on one
 * screen must not spend two of the five visits.
 */
const visited = new Set<HintId>();

/**
 * "Show this until the person has learned it" (ADR-266 §6, ADR-289).
 *
 * Returns whether the plate should be on screen now. `active` is where the hint could
 * be seen at all (a room with objects, no voting line): a visit that had nothing to
 * talk about does not count. The action itself calls `markHintDone` in its handler.
 */
export function useOnceHint(id: HintId, { active = true }: { active?: boolean } = {}) {
  const show = useSyncExternalStore(
    subscribeHints,
    () => !hintLearned(id),
    () => false,
  );

  useEffect(() => {
    if (!active || visited.has(id)) return;
    visited.add(id);
    markHintVisit(id);
  }, [id, active]);

  return { show: active && show, definition: hintDefinition(id) };
}
