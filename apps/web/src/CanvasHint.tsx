import { useI18n } from "./i18n";
import { useOnceHint } from "./useOnceHint";

/**
 * The first-use hint: one plate at the bottom centre, shown until the action is learned
 * (ADR-266 §6, ADR-289).
 *
 * It used to disappear after six seconds or the first gesture, whether or not anybody
 * had learned the double click. Now the registry counts the action and the visits: after
 * three edits or five visits the plate never returns, and "Show the hints again" brings
 * it back. While a voting line is shown it is not rendered at all, because the line is
 * the only thing that belongs in that slot (ADR-119.4, Н1).
 */
export function CanvasHint({ allowed }: { allowed: boolean }) {
  const { t } = useI18n();
  const { show, definition } = useOnceHint("canvas.doubleClickEdit", { active: allowed });

  if (!show) return null;
  return (
    <div className="canvas-hint" role="status">
      {t(definition.text)}
    </div>
  );
}
