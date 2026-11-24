import { Button, IconButton, Menu, Popover, Tooltip, readCanvasTokens, type MenuItem } from "@remo/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  SHAPE_PRESETS,
  resolveColor,
  type NamedColorRole,
  type StickySize,
  type TextMarks,
} from "@remo/model";
import { useI18n } from "../i18n";
import { useMenuFocus } from "../useMenuFocus";
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
import { HelpLink } from "../help/HelpLink";
import { TextFormatBar } from "./TextFormatBar";
import { LinkWindow } from "./LinkWindow";
import {
  SHAPE_KIND_LABEL,
  ShapeCorners,
  ShapeKindGrid,
  shapeSelection,
} from "./ShapeKindPicker";
import {
  applyEditorHref,
  commonBlock,
  editorFormat,
  editorRoot,
  isListBlock,
  linkAtNode,
  linksOf,
  saveEditorSelection,
  type BarBlock,
  type EditorFormat,
  type SavedSelection,
} from "../textFormatBar";
import {
  FORMAT_CHANGED_EVENT,
  LINK_OPEN_EVENT,
  dispatchInlineCode,
  dispatchLineBlock,
} from "../textFormatEvents";

export type { StickyBarActions, StickyBarTarget };

type PopoverName = "kind" | "colour" | "align" | "more" | "link" | null;

const NO_FORMAT: EditorFormat = { block: null, href: null, code: false };

const SIZES: StickySize[] = ["S", "M", "L"];
const MARKS: Array<{ mark: keyof TextMarks; glyph: string; key: string }> = [
  { mark: "bold", glyph: "B", key: "sticky.bold" },
  { mark: "italic", glyph: "I", key: "sticky.italic" },
  { mark: "underline", glyph: "U", key: "sticky.underline" },
  { mark: "strike", glyph: "S", key: "sticky.strike" },
];
const ALIGN_H = ["left", "center", "right"] as const;
const ALIGN_V = ["top", "middle", "bottom"] as const;

/**
 * The object toolbar for a note, a shape or a text object (ADR-120, ADR-127).
 *
 * One row above the selected object: the colour sample │ text size │ marks │ line
 * formats │ alignment │ More. The sample is what the object paints — the sheet, "Aa" in
 * the shape's own style, "A" with a colour bar for text — and pressing it opens the one
 * colour window. The line-format row follows the caret inside the editor and the whole
 * object outside it (ADR-252 §6). Buttons, popovers and the menu come from `@remo/ui`;
 * this file owns the order and which document action each control runs.
 */
export function StickyPanel({
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
  const { t, count } = useI18n();
  // A different object closes whatever was open for the previous one.
  const { open, setOpen, ref } = usePopover<PopoverName>(target?.id);
  const moreRef = useMenuFocus(open, "more");

  /**
   * What the editor's caret is on, read from the editor itself.
   *
   * `selectionchange` covers arrow keys, clicks and typing; `input` covers the bar's own
   * commands, which change formats without moving the caret. Outside editing the answer
   * comes from the object's `lines`, not from a second copy of the document.
   */
  const [caret, setCaret] = useState<EditorFormat>(NO_FORMAT);
  const savedRange = useRef<SavedSelection | null>(null);
  /** The link captured when the window opens; the caret's live value may lag a click. */
  const [linkHref, setLinkHref] = useState<string | null>(null);

  /**
   * Open the link window from the live selection.
   *
   * The range and the address are read together, before the field takes focus: a click
   * that has not yet reached `selectionchange` must not make "Remove link" unavailable.
   */
  const openLink = useCallback(() => {
    const saved = saveEditorSelection();
    savedRange.current = saved;
    setLinkHref(
      saved
        ? (linkAtNode(saved.range.startContainer, saved.root)?.getAttribute("href") ?? null)
        : null,
    );
    setOpen("link");
  }, [setOpen]);

  useEffect(() => {
    if (!editing) {
      setCaret(NO_FORMAT);
      setOpen((current) => (current === "link" ? null : current));
      return;
    }
    const update = () => setCaret(editorFormat());
    document.addEventListener("selectionchange", update);
    document.addEventListener("input", update);
    document.addEventListener(FORMAT_CHANGED_EVENT, update);
    update();
    return () => {
      document.removeEventListener("selectionchange", update);
      document.removeEventListener("input", update);
      document.removeEventListener(FORMAT_CHANGED_EVENT, update);
    };
  }, [editing, setOpen]);

  useEffect(() => {
    if (!editing) return;
    // ⌘K belongs to the editor's key handler; the window belongs to the bar.
    document.addEventListener(LINK_OPEN_EVENT, openLink);
    return () => document.removeEventListener(LINK_OPEN_EVENT, openLink);
  }, [editing, openLink]);

  /**
   * Escape closes the window in `usePopover`, before the window's own handler sees it.
   *
   * That is the right precedence for every popover, so the caret is returned here: a
   * keyboard user closes the link field and keeps typing, exactly as §9 asks.
   */
  const linkWasOpen = useRef(false);
  useEffect(() => {
    const wasOpen = linkWasOpen.current;
    linkWasOpen.current = open === "link";
    if (wasOpen && open !== "link") {
      savedRange.current = null;
      setLinkHref(null);
      editorRoot()?.focus();
    }
  }, [open]);

  if (!target || !target.editable) return null;

  const marks = target.marks ?? {};
  const explicit = target.fontSize;
  const sizeLabel = explicit == null ? t("sticky.auto") : String(explicit);
  const shape = target.kind === "shape";
  const text = target.kind === "text";
  const note = target.kind === "note";
  // `resolveColor` maps a named legacy shade through `STICKY_COLORS`, which does not know
  // transparency; the sample must keep the stored "nothing painted" value (ADR-140).
  const fill = isTransparent(target.fillColor)
    ? "transparent"
    : resolveColor(target.fillColor);
  // A free text object with no explicit colour follows the theme's primary text; the
  // painter reads the same token, so the bar's "A" is not a second guess.
  const ink = text && !target.ink ? readCanvasTokens()["text-primary"] : target.ink;
  const shapePreset = shape
    ? SHAPE_PRESETS.find((preset) => shapePresetSelected(preset, target))
    : undefined;
  const kind = shape ? shapeSelection([target.shapeKind ?? "rectangle"]) : null;
  // The sample is named by the same role list the window draws, so White, Black and
  // "None" read as words on the bar too (ADR-140).
  const colourRole: NamedColorRole = shape ? "fill" : text ? "text" : "note";
  const valueName = shape
    ? shapePreset
      ? t(`preset.shape.${shapePreset.id}` as "preset.shape.plain")
      : t("color.customStyle")
    : t(
        colorName(text ? target.textColor : fill, { auto: text, role: colourRole }).key,
      );
  const colourLabel = shape
    ? `${t("shape.style")}: ${valueName}`
    : text
      ? `${t("object.text")}: ${valueName}`
      : `${t("note.sheetColour")}: ${valueName}`;

  // The bar is about one thing at a time: the selection inside the editor, or every
  // line of the object. Nothing is pressed when the lines disagree (ADR-252 §6).
  const block: BarBlock | null = editing ? caret.block : commonBlock(target.lines);
  const codeMark = editing ? caret.code : Boolean(marks.code);
  const objectLinks = editing ? [] : linksOf(target.lines);
  const listLines = (target.lines ?? []).filter((line) => isListBlock(line.block));
  const canIndentMore = !editing && listLines.some((line) => line.indent < 2);
  const canIndentLess = !editing && listLines.some((line) => line.indent > 0);

  const setBlock = (next: BarBlock) => {
    if (!editing) {
      actions.setLineBlock(next);
      return;
    }
    const root = editorRoot();
    if (!root) return;
    // The editor toggles: the same format again is "plain line".
    dispatchLineBlock(root, block === next ? null : next);
  };

  const toggleCode = () => {
    if (!editing) {
      actions.toggleMark("code");
      return;
    }
    const root = editorRoot();
    if (root) dispatchInlineCode(root);
  };

  const closeLink = () => {
    savedRange.current = null;
    setLinkHref(null);
    setOpen(null);
    editorRoot()?.focus();
  };

  const applyLink = (href: string) => {
    const saved = savedRange.current;
    if (saved) applyEditorHref(saved, href);
    closeLink();
  };

  const removeLink = () => {
    const saved = savedRange.current;
    if (saved) applyEditorHref(saved, null);
    closeLink();
  };

  /**
   * The bar's "⋯" items, in one list.
   *
   * Indentation and "Open link" act on the whole object, so they are absent while the
   * editor is open: there Tab and the window's own field are the way. Clearing works in
   * both modes and is the same command as ⌘\ (§5.3).
   */
  const moreItems: MenuItem[] = [];
  if (target.richBlocks && !editing) {
    moreItems.push(
      {
        label: t("sticky.indentMore"),
        icon: "plus",
        disabled: !canIndentMore,
        onSelect: () => {
          actions.setLineIndent(1);
          setOpen(null);
        },
      },
      {
        label: t("sticky.indentLess"),
        icon: "minus",
        disabled: !canIndentLess,
        onSelect: () => {
          actions.setLineIndent(-1);
          setOpen(null);
        },
      },
    );
    if (objectLinks.length === 1) {
      moreItems.push({
        label: t("sticky.openLink"),
        icon: "link",
        onSelect: () => {
          // A stored link is only ever http(s) or mailto — the document checks it on the
          // way in — and `noopener` keeps the room out of reach of the page.
          window.open(objectLinks[0]!, "_blank", "noopener,noreferrer");
          setOpen(null);
        },
      });
    }
  }
  moreItems.push({
    label: t("sticky.clearFormatting"),
    icon: "clear-format",
    onSelect: () => {
      if (editing) clearSelection();
      else actions.clearFormatting();
      setOpen(null);
    },
  });

  return (
    <ObjectBar ref={ref} placement={target.placement} label={t("sticky.properties")}>
      {shape && kind && (
        <>
          <span className="sb-anchor">
            <Button
              variant="ghost"
              size="compact"
              className="sb-kind"
              iconEnd="chevron-down"
              aria-label={`${t("shape.kind")}: ${t(SHAPE_KIND_LABEL[kind.kind ?? "rectangle"])}`}
              aria-haspopup="dialog"
              aria-expanded={open === "kind"}
              selected={open === "kind"}
              onClick={() => setOpen(open === "kind" ? null : "kind")}
            >
              {t("shape.kind")}
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
                </Popover>
              </PanelWindow>
            )}
          </span>
          <ShapeCorners
            rounded={kind.rounded}
            disabled={!kind.canRound}
            onChange={(rounded) =>
              actions.setShapeKind(rounded ? "round_rectangle" : "rectangle")
            }
          />
          <span className="sb-divider" aria-hidden="true" />
        </>
      )}
      <span className="sb-anchor">
        <Button
          variant="ghost"
          size="compact"
          className="sb-colour"
          iconEnd="chevron-down"
          aria-label={colourLabel}
          aria-haspopup="dialog"
          aria-expanded={open === "colour"}
          selected={open === "colour"}
          onClick={() => setOpen(open === "colour" ? null : "colour")}
        >
          {shape ? (
            <span
              className={
                isTransparent(fill) ? "sb-aa-preview checkerboard" : "sb-aa-preview"
              }
              aria-hidden="true"
              style={{
                background: isTransparent(fill) ? undefined : fill,
                borderColor: target.strokeColor ?? DEFAULT_INK,
                borderWidth: target.strokeWidth == null ? 2 : Math.min(target.strokeWidth, 2),
                borderStyle:
                  target.strokeStyle === "dashed"
                    ? "dashed"
                    : target.strokeStyle === "dotted"
                      ? "dotted"
                      : "solid",
                color: ink,
              }}
            >
              Aa
            </span>
          ) : text ? (
            <span className="sb-text-preview" style={{ color: ink }} aria-hidden="true">
              A<span className="sb-text-bar" />
            </span>
          ) : (
            <span
              className={
                isTransparent(fill) ? "sb-note-preview checkerboard" : "sb-note-preview"
              }
              style={{ background: isTransparent(fill) ? undefined : fill }}
              aria-hidden="true"
            />
          )}
        </Button>
        {open === "colour" &&
          (shape ? (
            <ShapeColourWindow
              target={target}
              actions={actions}
              onClose={() => setOpen(null)}
            />
          ) : text ? (
            <TextColourWindow
              target={target}
              actions={actions}
              onClose={() => setOpen(null)}
            />
          ) : (
            <NoteColourWindow
              target={target}
              actions={actions}
              onClose={() => setOpen(null)}
            />
          ))}
      </span>

      <span className="sb-divider" aria-hidden="true" />

      {note && (
        <>
          <div className="sb-group" role="group" aria-label={t("sticky.size")}>
            {SIZES.map((size) => (
              <Tooltip key={size} label={t("sticky.sizeName", { size })}>
                <Button
                  variant="ghost"
                  size="compact"
                  className="sb-size"
                  aria-label={t("sticky.sizeName", { size })}
                  selected={size === target.size}
                  onClick={() => actions.setSize(size)}
                >
                  {size}
                </Button>
              </Tooltip>
            ))}
          </div>
          <span className="sb-divider" aria-hidden="true" />
        </>
      )}

      <div className="sb-group sb-font" role="group" aria-label={t("sticky.textSize")}>
        <Tooltip
          label={
            explicit == null
              ? t("sticky.autoValue", { size: target.autoSize })
              : t("sticky.autoHint")
          }
        >
          <Button
            variant="ghost"
            size="compact"
            className="sb-auto"
            aria-label={sizeLabel}
            selected={explicit == null}
            onClick={() => actions.setFont(null)}
          >
            {sizeLabel}
          </Button>
        </Tooltip>
        <IconButton
          icon="minus"
          size="compact"
          label={t("sticky.smaller")}
          onClick={() => actions.setFont(Math.max(6, (explicit ?? target.autoSize) - 1))}
        />
        <IconButton
          icon="plus"
          size="compact"
          label={t("sticky.bigger")}
          onClick={() => actions.setFont(Math.min(96, (explicit ?? target.autoSize) + 1))}
        />
      </div>

      <span className="sb-divider" aria-hidden="true" />

      <div className="sb-group" role="group" aria-label={t("sticky.styles")}>
        {MARKS.map((entry) => {
          const name = t(entry.key as "sticky.bold");
          return (
            <Tooltip key={entry.mark} label={name}>
              <Button
                variant="ghost"
                size="compact"
                className={`sb-mark sb-${entry.mark}`}
                aria-label={name}
                selected={Boolean(marks[entry.mark])}
                onClick={() =>
                  editing ? formatSelection(entry.mark) : actions.toggleMark(entry.mark)
                }
              >
                {entry.glyph}
              </Button>
            </Tooltip>
          );
        })}
      </div>

      {target.richBlocks && (
        <>
          <span className="sb-divider" aria-hidden="true" />
          <div className="sb-anchor">
            <TextFormatBar
              block={block}
              code={codeMark}
              link={editing && Boolean(caret.href)}
              editing={editing}
              onBlock={setBlock}
              onCode={toggleCode}
              onLink={openLink}
            />
            {open === "link" && editing && (
              <PanelWindow>
                <LinkWindow
                  href={linkHref}
                  canApply={Boolean(
                    savedRange.current &&
                      (!savedRange.current.range.collapsed || linkHref),
                  )}
                  onApply={applyLink}
                  onRemove={removeLink}
                  onClose={closeLink}
                />
              </PanelWindow>
            )}
          </div>
        </>
      )}

      <span className="sb-divider" aria-hidden="true" />

      <span className="sb-anchor sb-anchor-center">
        <Button
          variant="ghost"
          size="compact"
          className="sb-icon"
          aria-label={t("sticky.alignment")}
          aria-haspopup="dialog"
          aria-expanded={open === "align"}
          selected={open === "align"}
          onClick={() => setOpen(open === "align" ? null : "align")}
        >
          <span aria-hidden="true" className="sb-align-glyph">
            {target.align === "left" ? "⇤" : target.align === "right" ? "⇥" : "↔"}
          </span>
        </Button>
        {open === "align" && (
          <PanelWindow>
            <Popover label={t("sticky.alignment")} width={124} onClose={() => setOpen(null)}>
              <div className="sb-align-grid" role="group" aria-label={t("sticky.alignment")}>
                {ALIGN_V.map((v) => (
                  <div key={v} className="sb-align-row">
                    {ALIGN_H.map((horizontal) => (
                      <Button
                        key={horizontal}
                        variant="ghost"
                        size="compact"
                        className="sb-align-cell"
                        aria-label={t("sticky.alignCell", {
                          horizontal: t(`sticky.align.${horizontal}` as "sticky.align.left"),
                          vertical: t(`sticky.align.${v}` as "sticky.align.top"),
                        })}
                        selected={target.align === horizontal && target.vAlign === v}
                        onClick={() => {
                          actions.setAlign(horizontal);
                          actions.setVAlign(v);
                          setOpen(null);
                        }}
                      >
                        <span aria-hidden="true" />
                      </Button>
                    ))}
                  </div>
                ))}
              </div>
            </Popover>
          </PanelWindow>
        )}
      </span>

      <span className="sb-divider" aria-hidden="true" />

      {/* Delete lives here and nowhere else on the bar, after a separator (ADR-120). */}
      <span className="sb-more" ref={moreRef}>
        <IconButton
          icon="more"
          size="compact"
          label={t("sticky.more")}
          aria-expanded={open === "more"}
          selected={open === "more"}
          onClick={() => setOpen(open === "more" ? null : "more")}
        />
        {open === "more" && (
          <PanelWindow>
            <Menu
              label={t("sticky.more")}
              onClose={() => setOpen(null)}
              items={[
                ...moreItems,
                { separator: true },
                {
                  label: t("menu.delete"),
                  icon: "trash",
                  hint: count("objects", 1),
                  danger: true,
                  onSelect: () => {
                    actions.remove();
                    setOpen(null);
                  },
                },
              ]}
            />
          </PanelWindow>
        )}
      </span>

      <HelpLink topicId="room.colours" className="sb-help" />
    </ObjectBar>
  );
}
