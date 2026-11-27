import { Button } from "@remo/ui";
import type { ModelSelection } from "@remo/agent-plan/model-context";
import { useI18n } from "./i18n";

/**
 * What the task will read from the board (ADR-143).
 *
 * The list is a preview of the server's expansion: groups and a frame are already
 * expanded, the count is the number of objects that will reach the model, and the
 * character count is the text cap. "Remove" keeps the task but drops the selection;
 * "Selection only" makes the selection the task itself. The board selection is not
 * changed: this is about the source, not about what is highlighted.
 */
export function AgentSelectionSource({
  preview,
  hasSelection,
  selectionOnly,
  onRemove,
  onOnly,
}: {
  preview: ModelSelection;
  hasSelection: boolean;
  selectionOnly: boolean;
  onRemove: () => void;
  onOnly: () => void;
}) {
  const { t } = useI18n();
  return (
    <section className="agent-source" aria-label={t("agents.source.title")}>
      <strong>{t("agents.source.title")}</strong>
      {hasSelection ? (
        <>
          <p className="muted">
            {t("agents.source.summary", {
              objects: preview.objects.length,
              groups: preview.counts.groups,
              frames: preview.counts.frames,
            })}
          </p>
          <p className="muted">{t("agents.source.chars", { chars: preview.counts.chars })}</p>
          {preview.truncated && (
            <p className="muted">
              {t("agents.source.truncated", {
                objects: preview.objects.length,
                chars: preview.counts.chars,
              })}
            </p>
          )}
          <div className="agent-source-actions">
            <Button variant="ghost" size="compact" onClick={onRemove}>
              {t("agents.source.remove")}
            </Button>
            <Button variant="ghost" size="compact" onClick={onOnly}>
              {t("agents.source.only")}
            </Button>
          </div>
          {selectionOnly && <p className="muted">{t("agents.source.onlyIntent")}</p>}
        </>
      ) : (
        <p className="muted">{t("agents.source.empty")}</p>
      )}
    </section>
  );
}
