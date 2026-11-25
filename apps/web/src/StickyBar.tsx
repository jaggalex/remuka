import type { TextMarks } from "@remo/model";
import {
  StickyPanel,
  type StickyBarActions,
  type StickyBarTarget,
} from "./object-panel/StickyPanel";
import { TextBar } from "./TextBar";

export type { StickyBarActions, StickyBarTarget };

/**
 * The note bar's entry point.
 *
 * Two compositions, one owner: while the text is open for typing the bar is the text
 * format row (T8), otherwise it is the object bar. `StickyPanel` holds the object half;
 * `TextBar` the editor half; both use the same frame and the same «⋯» destination.
 */
export function StickyBar({
  target,
  actions,
  editing,
  formatSelection,
  clearSelection,
}: {
  target: StickyBarTarget | null;
  actions: StickyBarActions;
  /** While the note is open for typing, marks apply to the selection, not the note. */
  editing: boolean;
  formatSelection: (mark: keyof TextMarks) => void;
  /** While typing, "Clear formatting" strips the selection instead of the note. */
  clearSelection: () => void;
}) {
  if (editing && target) {
    return (
      <TextBar
        placement={target.placement}
        formatSelection={formatSelection}
        onMore={actions.openProperties}
      />
    );
  }
  return (
    <StickyPanel
      target={target}
      actions={actions}
      editing={editing}
      formatSelection={formatSelection}
      clearSelection={clearSelection}
    />
  );
}
