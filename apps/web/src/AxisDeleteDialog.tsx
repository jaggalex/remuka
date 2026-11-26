import type { BoardDocument } from "@remo/doc";
import { deleteAxis, tableLayoutOf } from "@remo/doc";
import type { Widget } from "@remo/model";
import { useId, useState } from "react";
import { Button, Dialog, Radio } from "@remo/ui";
import { useI18n } from "./i18n";

/**
 * The one confirmation for deleting an axis that holds objects (ADR-196).
 *
 * Both entry points use it: the section panel and the axis menu on the canvas. It offers
 * only neighbours that exist and moves by default; deleting the objects is the explicit
 * second choice. One transaction and one undo per action.
 */
export interface AxisDeleteTarget {
  frameId: string;
  axisId: string;
  kind: "column" | "row";
}

export function AxisDeleteDialog({
  board,
  widgets,
  target,
  onClose,
  onDeleted,
}: {
  board: BoardDocument;
  widgets: Widget[];
  target: AxisDeleteTarget;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { t, count } = useI18n();
  const group = useId();
  const [choice, setChoice] = useState<string | null>(null);
  const layout = tableLayoutOf(board, target.frameId);
  const axes = layout
    ? target.kind === "column"
      ? layout.columns
      : layout.rows
    : [];
  const axis = axes.find((entry) => entry.id === target.axisId);
  if (!layout || !axis) return null;

  const index = axes.findIndex((entry) => entry.id === axis.id);
  const before = index > 0 ? axes[index - 1] : undefined;
  const after = index >= 0 && index < axes.length - 1 ? axes[index + 1] : undefined;
  const field = target.kind === "column" ? "columnId" : "rowId";
  const objects = widgets.filter(
    (widget) => widget.parentId === target.frameId && widget.cell?.[field] === axis.id,
  );
  const name = axis.title || t("section.axis.untitled");

  const neighbours = [
    before && { axis: before, label: t(target.kind === "column" ? "section.axis.moveToLeft" : "section.axis.moveToAbove", {name: before.title || t("section.axis.untitled")}) },
    after && { axis: after, label: t(target.kind === "column" ? "section.axis.moveToRight" : "section.axis.moveToBelow", {name: after.title || t("section.axis.untitled")}) },
  ].filter(entry => entry !== undefined);
  const destination = choice === null
    ? neighbours[0]
    : neighbours.find(entry => "to:" + entry.axis.id === choice);
  const removeObjects = choice === "remove";
  const confirmLabel = removeObjects ? t("section.axis.deleteWithObjects", { count: objects.length })
    : t(target.kind === "row" ? "section.axis.deleteRow" : "section.axis.deleteColumn");
  const finish = () => {
    if (!removeObjects && !destination) return;
    const outcome = deleteAxis(board, target.frameId, axis.id, removeObjects ? { mode: "withObjects" }
      : { mode: "move", toAxisId: destination!.axis.id });
    if (outcome.ok) onDeleted();
  };
  const prompt = t(target.kind === "row" ? "section.axis.deleteRowBody" : "section.axis.deleteBody",
    { count: count("objects", objects.length) });
  return (
    <Dialog title={t(target.kind === "row" ? "section.axis.deleteRowTitle" : "section.axis.deleteTitle", { name })}
      size="sm" className="axis-delete-sheet" onClose={onClose} footer={<>
        <Button variant="secondary" onClick={onClose}>{t("delete.cancel")}</Button>
        <Button variant={removeObjects ? "danger" : "primary"} onClick={finish} disabled={!destination && !removeObjects}>{confirmLabel}</Button>
      </>}>
      <fieldset className="axis-delete-choices">
        <legend>{prompt}</legend>
        {neighbours.map(entry => <Radio key={entry.axis.id} name={group} label={entry.label}
          checked={!removeObjects && destination?.axis.id === entry.axis.id} onChange={() => setChoice("to:" + entry.axis.id)} />)}
        <Radio name={group} label={t("section.axis.deleteWithObjects", { count: objects.length })}
          checked={removeObjects} onChange={() => setChoice("remove")} />
      </fieldset>
      <p className="muted">{t("section.axis.undoHint")}</p>
    </Dialog>
  );
}
