import { Button, Icon, IconButton, Popover, Tooltip } from "@remo/ui";
import {
  SHAPE_PRESETS,
  resolveColor,
  type NamedColorRole,
  type TextMarks,
} from "@remo/model";
import { useI18n } from "../i18n";
import { usePopover } from "../usePopover";
import { ObjectBar } from "./ObjectBar";
import {
  NoteColourWindow,
  ShapeColourWindow,
  TextColourWindow,
  shapePresetSelected,
} from "./ColourWindows";
import { colorName, isTransparent } from "./colorWindowData";
import { PanelWindow } from "./PanelWindow";
import type { StickyBarActions, StickyBarTarget } from "./stickyTypes";
import { DEFAULT_INK } from "../objectDefaults";
import { SHAPE_KIND_LABEL, ShapeCorners, ShapeKindGrid, shapeSelection } from "./ShapeKindPicker";

export type { StickyBarActions, StickyBarTarget };

type PopoverName = "kind" | "colour" | "size" | "width" | null;

/**
 * The bar above a note, a shape or a text object (ADR-120, ADR-266 §10a).
 *
 * One row of the things changed most: the colour sample, the text size, the few marks,
 * the link, the connector, and «⋯» for everything else. The mockup fixes the order and
 * the count — each single-object bar has seven buttons (ADR-300). Everything rarer is in the properties panel, which «⋯» opens; a second
 * menu here would be a second way to the same document write.
 */
export function StickyPanel({
  target,
  actions,
  editing,
}: {
  target: StickyBarTarget | null;
  actions: StickyBarActions;
  /** While the note is open for typing, marks apply to the selection, not the note. */
  editing: boolean;
  formatSelection: (mark: keyof TextMarks) => void;
  /** While typing, "Clear formatting" strips the selection instead of the note. */
  clearSelection: () => void;
}) {
  const { t } = useI18n();
  const { open, setOpen, ref } = usePopover<PopoverName>(target?.id);

  if (!target || !target.editable) return null;

  const shape = target.kind === "shape";
  const text = target.kind === "text";
  const note = target.kind === "note";
  const explicit = target.fontSize;
  const sizeLabel = explicit == null ? t("sticky.auto") : String(explicit);
  const fill = isTransparent(target.fillColor)
    ? "transparent"
    : resolveColor(target.fillColor);
  const shapePreset = shape
    ? SHAPE_PRESETS.find((preset) => shapePresetSelected(preset, target))
    : undefined;
  const kind = shape ? shapeSelection([target.shapeKind ?? "rectangle"]) : null;
  const colourRole: NamedColorRole = shape ? "fill" : text ? "text" : "note";
  const valueName = shape
    ? shapePreset
      ? t(`preset.shape.${shapePreset.id}` as "preset.shape.plain")
      : t("color.customStyle")
    : t(colorName(text ? target.textColor : fill, { auto: text, role: colourRole }).key);
  const colourLabel = shape
    ? `${t("shape.style")}: ${valueName}`
    : text
      ? `${t("object.text")}: ${valueName}`
      : `${t("note.sheetColour")}: ${valueName}`;

  const marks = target.marks ?? {};
  const needsOpenText = note || text;

  const inkPreview = text && !target.ink ? undefined : target.ink;
  const barClass = shape ? "shape-selection-bar" : note && !editing ? "note-selection-bar" : undefined;

  return (
    <ObjectBar ref={ref} placement={target.placement} label={t("sticky.properties")} className={barClass}>
      <span className="sb-anchor">
        <Button
          variant="ghost"
          size="compact"
          className="sb-colour"
          iconEnd={text ? "chevron-down" : undefined}
          aria-label={colourLabel}
          aria-haspopup="dialog"
          aria-expanded={open === "colour"}
          selected={open === "colour"}
          onClick={() => setOpen(open === "colour" ? null : "colour")}
        >
          {shape ? (
            <span
              className={isTransparent(fill) ? "sb-paint-sample checkerboard" : "sb-paint-sample"}
              aria-hidden="true"
              style={{ background: isTransparent(fill) ? undefined : fill }}
            />
          ) : text ? (
            <span className="sb-text-preview" style={{ color: inkPreview }} aria-hidden="true">
              A<span className="sb-text-bar" />
            </span>
          ) : (
            <span
              className={isTransparent(fill) ? "sb-note-preview checkerboard" : "sb-note-preview"}
              style={{ background: isTransparent(fill) ? undefined : fill }}
              aria-hidden="true"
            />
          )}
        </Button>
        {open === "colour" &&
          (shape ? (
            <ShapeColourWindow target={target} actions={actions} onClose={() => setOpen(null)} />
          ) : text ? (
            <TextColourWindow target={target} actions={actions} onClose={() => setOpen(null)} />
          ) : (
            <NoteColourWindow target={target} actions={actions} onClose={() => setOpen(null)} />
          ))}
      </span>

      {shape && (
        <>
          <span className="sb-anchor">
            <Button
              variant="ghost"
              size="compact"
              className="sb-colour sb-shape-border"
              aria-label={`${t("object.border")}: ${t("color.customStyle")}`}
              aria-haspopup="dialog"
              aria-expanded={open === "colour"}
              selected={open === "colour"}
              onClick={() => setOpen(open === "colour" ? null : "colour")}
            >
              <span
                className={isTransparent(target.strokeColor) ? "sb-paint-sample checkerboard is-none" : "sb-paint-sample"}
                aria-hidden="true"
                style={{ background: isTransparent(target.strokeColor) ? undefined : target.strokeColor ?? DEFAULT_INK }}
              />
            </Button>
          </span>
          <span className="sb-anchor">
            <Button
              variant="ghost"
              size="compact"
              className="sb-width"
              aria-label={`${t("shape.outlineWidth")}: ${target.strokeWidth ?? 2}`}
              aria-haspopup="dialog"
              aria-expanded={open === "width"}
              selected={open === "width"}
              onClick={() => setOpen(open === "width" ? null : "width")}
            >
              {target.strokeWidth ?? 2} px
            </Button>
            {open === "width" && (
              <PanelWindow>
                <Popover title={t("shape.outlineWidth")} width={148} onClose={() => setOpen(null)}>
                  <div className="sb-size-row" role="group" aria-label={t("shape.outlineWidth")}>
                    {[1, 2, 4].map((width) => (
                      <Button
                        key={width}
                        variant="ghost"
                        size="compact"
                        selected={(target.strokeWidth ?? 2) === width}
                        onClick={() => {
                          actions.setStrokeWidth(width);
                          setOpen(null);
                        }}
                      >
                        {width} px
                      </Button>
                    ))}
                  </div>
                </Popover>
              </PanelWindow>
            )}
          </span>
        </>
      )}

      {text && <span className="sb-divider" aria-hidden="true" />}

      {shape && kind && (
        <>
          <span className="sb-anchor">
            <Button
              variant="ghost"
              size="compact"
              className="sb-kind"
              aria-label={`${t("shape.kind")}: ${t(SHAPE_KIND_LABEL[kind.kind ?? "rectangle"])}`}
              aria-haspopup="dialog"
              aria-expanded={open === "kind"}
              selected={open === "kind"}
              onClick={() => setOpen(open === "kind" ? null : "kind")}
            >
              <Icon name="shape" size={20} />
            </Button>
            {open === "kind" && (
              <PanelWindow>
                <Popover title={t("shape.kindTitle")} width={240} onClose={() => setOpen(null)}>
                  <ShapeKindGrid
                    value={kind.kind}
                    ariaLabel={t("shape.kindTitle")}
                    onPick={(next) => {
                      actions.setShapeKind(next);
                      setOpen(null);
                    }}
                  />
                  <div className="shape-kind-corners">
                    <ShapeCorners
                      rounded={kind.rounded}
                      disabled={!kind.canRound}
                      onChange={(rounded) => {
                        actions.setShapeKind(rounded ? "round_rectangle" : "rectangle");
                        setOpen(null);
                      }}
                    />
                  </div>
                </Popover>
              </PanelWindow>
            )}
          </span>
          <span className="sb-divider" aria-hidden="true" />
          <Tooltip label={t("inspector.editText")}>
            <IconButton
              icon="text"
              size="compact"
              label={t("inspector.editText")}
              onClick={actions.edit}
            />
          </Tooltip>
        </>
      )}

      {!shape && (
        <>
          <span className="sb-anchor">
            <Button
              variant="ghost"
              size="compact"
              className="sb-auto"
              aria-label={t("sticky.textSize") + " · " + sizeLabel}
              aria-haspopup="dialog"
              aria-expanded={open === "size"}
              onClick={() => setOpen(open === "size" ? null : "size")}
            >
              Aa · {sizeLabel.toLowerCase()}
            </Button>
            {open === "size" && (
              <PanelWindow>
                <Popover title={t("sticky.textSize")} width={172} onClose={() => setOpen(null)}>
                  <div className="sb-size-row" role="group" aria-label={t("sticky.textSize")}>
                    <Button
                      variant="ghost"
                      size="compact"
                      selected={explicit == null}
                      onClick={() => {
                        actions.setFont(null);
                        setOpen(null);
                      }}
                    >
                      {t("sticky.auto")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="compact"
                      onClick={() =>
                        actions.setFont(Math.max(6, (explicit ?? target.autoSize) - 1))
                      }
                    >
                      A−
                    </Button>
                    <Button
                      variant="ghost"
                      size="compact"
                      onClick={() =>
                        actions.setFont(Math.min(96, (explicit ?? target.autoSize) + 1))
                      }
                    >
                      A+
                    </Button>
                  </div>
                </Popover>
              </PanelWindow>
            )}
          </span>

          <span className="sb-divider" aria-hidden="true" />

          <Tooltip label={t("sticky.bold")}>
            <IconButton
              icon="text-bold"
              size="compact"
              label={t("sticky.bold")}
              selected={Boolean(marks.bold)}
              onClick={() => actions.toggleMark("bold")}
            />
          </Tooltip>

          {text && (
            <Tooltip label={t("sticky.italic")}>
              <IconButton
                icon="text-italic"
                size="compact"
                label={t("sticky.italic")}
                selected={Boolean(marks.italic)}
                onClick={() => actions.toggleMark("italic")}
              />
            </Tooltip>
          )}

          {note && (
            <Tooltip label={t("sticky.checklist")}>
              <IconButton
                icon="list-check"
                size="compact"
                label={t("sticky.checklist")}
                selected={Boolean(target.lines?.some((line) => line.block === "check"))}
                onClick={() => actions.setLineBlock("check")}
              />
            </Tooltip>
          )}

          <Tooltip label={t("sticky.link")}>
            <IconButton
              icon="link"
              iconSize={note ? 18 : undefined}
              size="compact"
              label={needsOpenText ? t("sticky.linkNeedsEdit") : t("sticky.link")}
              onClick={actions.edit}
            />
          </Tooltip>
        </>
      )}

      {!shape && <span className="sb-divider" aria-hidden="true" />}

      <span className="sb-group" role="group" aria-label={t("inspector.actions")}>
        <Tooltip
          label={actions.canConnect ? t("inspector.connect") : t("inspector.connectHint")}
        >
          <IconButton
            icon="connector"
            size="compact"
            label={t("inspector.connect")}
            disabled={!actions.canConnect}
            onClick={actions.connect}
          />
        </Tooltip>
      </span>

      <Tooltip label={t("inspector.moreActions")}>
        <IconButton
          icon="more"
          size="compact"
          label={t("inspector.moreActions")}
          aria-haspopup="dialog"
          onClick={actions.openProperties}
        />
      </Tooltip>

    </ObjectBar>
  );
}
