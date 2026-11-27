import { useCallback, useEffect, useRef } from "react";
import { deleteWidgets, type BoardDocument } from "@remo/doc";
import type { ShapeKind, Vec2 } from "@remo/model";

/**
 * A sticky or a text object created from the rail opens ready to type, and disappears
 * if it is left empty (the source product's behaviour).
 *
 * Only the id created by this session is a candidate for removal; closing an existing
 * editor must never delete the object being edited.
 */
export function useNewObjectEditing({
  board,
  addSticky,
  addText,
  addShape,
  setEditingId,
}: {
  board: BoardDocument;
  addSticky: (fill?: string, at?: Vec2) => string;
  addText: (at?: Vec2) => string;
  addShape: (kind: ShapeKind) => string;
  setEditingId: (id: string | null) => void;
}) {
  const created = useRef<string | null>(null);

  useEffect(() => () => board.editPlacedText(null), [board]);

  const begin = useCallback(
    (id: string, keepEmpty = false) => {
      created.current = keepEmpty ? null : id;
      board.editPlacedText(keepEmpty ? id : null);
      setEditingId(id);
    },
    [board, setEditingId],
  );

  const addStickyAndEdit = useCallback(
    (fill?: string, at?: Vec2, placed = false) => begin(addSticky(fill, at), placed),
    [addSticky, begin],
  );

  const addTextAndEdit = useCallback((at?: Vec2, placed = false) => begin(addText(at), placed), [addText, begin]);

  const addShapeAndEdit = useCallback(
    (kind: ShapeKind) => begin(addShape(kind)),
    [addShape, begin],
  );

  const finishEditing = useCallback(() => {
    board.editPlacedText(null);
    const id = created.current;
    created.current = null;
    if (id) {
      const widget = board.widgets.get(id);
      const empty = widget && !board.textOf(id).trim();
      const disposable = widget?.type === "sticky_note" || widget?.type === "text";
      if (empty && disposable) deleteWidgets(board, [id]);
    }
    setEditingId(null);
  }, [board, setEditingId]);

  return { addStickyAndEdit, addTextAndEdit, addShapeAndEdit, finishEditing };
}
