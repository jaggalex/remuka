import { useCallback } from "react";
import { kindOf } from "@remo/model";
import { linesOf, setLineFormat, type BoardDocument } from "@remo/doc";
import { isListBlock, type BarBlock } from "./textFormatBar";
import { lineFormatFor } from "./richText";

/**
 * Line formats of the selection, outside the editor (ADR-252 §6, §8).
 *
 * The bar and the ⌘⇧7/8/9 keys ask the same question — "make every line of these
 * objects a bullet" — and both answer it here, so a button and a shortcut cannot
 * disagree. Kept out of `useBoardCommands` because it is one command family with its
 * own rules, and because that file is at the architecture ratchet.
 */
export function useTextFormatCommands(
  board: BoardDocument,
  selectedIds: readonly string[],
) {
  /** The objects that take block formats, with their lines read once per command. */
  const textLineTargets = useCallback(
    (ids: readonly string[]) =>
      ids.flatMap((id) => {
        const widget = board.readWidget(id);
        if (!widget || widget.locked || !kindOf(widget.type).richBlocks) return [];
        return [{ id, lines: linesOf(board.deltaOf(id)) }];
      }),
    [board],
  );

  /**
   * One block format for every line of the selection.
   *
   * Outside the editor there is no caret, so "apply a heading" means the whole object.
   * Pressing the format every line already has removes it; one `transact` wraps every
   * line of every selected object, so this is one undo step whatever the selection is.
   */
  const applyLineBlock = useCallback(
    (block: BarBlock) => {
      const targets = textLineTargets(selectedIds);
      if (!targets.length) return;
      const clear = targets.every(
        (target) => target.lines.length > 0 && target.lines.every((line) => line.block === block),
      );
      board.transact(() => {
        for (const target of targets) {
          for (const [index, line] of target.lines.entries()) {
            const format = clear
              ? null
              : lineFormatFor(block, {
                  block: line.block,
                  indent: line.indent === 1 || line.indent === 2 ? line.indent : 0,
                });
            setLineFormat(board, target.id, index, format);
          }
        }
      });
    },
    [board, selectedIds, textLineTargets],
  );

  /** Level of every list line one step deeper or shallower; headings stay as they are. */
  const applyLineIndent = useCallback(
    (direction: 1 | -1) => {
      const targets = textLineTargets(selectedIds);
      if (!targets.length) return;
      board.transact(() => {
        for (const target of targets) {
          for (const [index, line] of target.lines.entries()) {
            if (!isListBlock(line.block)) continue;
            const indent = Math.max(0, Math.min(2, line.indent + direction));
            if (indent === line.indent) continue;
            setLineFormat(board, target.id, index, {
              block: line.block,
              ...(indent ? { indent: indent as 1 | 2 } : {}),
            });
          }
        }
      });
    },
    [board, selectedIds, textLineTargets],
  );

  return { applyLineBlock, applyLineIndent };
}
