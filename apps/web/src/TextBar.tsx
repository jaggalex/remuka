import { useCallback, useEffect, useRef, useState } from "react";
import { IconButton, Tooltip } from "@remo/ui";
import type { TextMarks } from "@remo/model";
import { useI18n } from "./i18n";
import { ObjectBar } from "./object-panel/ObjectBar";
import {
  applyEditorHref,
  editorFormat,
  editorRoot,
  linkAtNode,
  saveEditorSelection,
  type BarBlock,
  type EditorFormat,
  type SavedSelection,
} from "./textFormatBar";
import {
  FORMAT_CHANGED_EVENT,
  LINK_OPEN_EVENT,
  dispatchLineBlock,
  dispatchLinkOpen,
} from "./textFormatEvents";
import { LinkWindow } from "./object-panel/LinkWindow";
import { PanelWindow } from "./object-panel/PanelWindow";

const NO_FORMAT: EditorFormat = { block: null, href: null, code: false };

/**
 * The bar of the text being edited (ADR-266 §10a, T8).
 *
 * One row: bold, italic, strikethrough │ bulleted list, checklist │ link, «⋯». Six
 * controls and «⋯» — the rest of the format lives behind «⋯», in the properties panel,
 * because a bar over the caret must not cover the text it formats. Every button keeps
 * the caret where it is: `ObjectBar` suppresses the pointer's focus change.
 */
export function TextBar({
  placement,
  formatSelection,
  onMore,
}: {
  placement: { left: number; top: number };
  /** Apply one mark to the editor's selection (the canvas owns the DOM selection). */
  formatSelection: (mark: keyof TextMarks) => void;
  onMore: () => void;
}) {
  const { t } = useI18n();
  const [caret, setCaret] = useState<EditorFormat>(NO_FORMAT);
  const [linkHref, setLinkHref] = useState<string | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const savedRange = useRef<SavedSelection | null>(null);

  /**
   * ⌘K belongs to the editor's key handler; the window belongs to the bar (ADR-252 §6).
   * The range and address are read together, before the field takes focus.
   */
  const openLink = useCallback(() => {
    const saved = saveEditorSelection();
    savedRange.current = saved;
    setLinkHref(
      saved
        ? (linkAtNode(saved.range.startContainer, saved.root)?.getAttribute("href") ?? null)
        : null,
    );
    setLinkOpen(true);
  }, []);

  useEffect(() => {
    document.addEventListener(LINK_OPEN_EVENT, openLink);
    return () => document.removeEventListener(LINK_OPEN_EVENT, openLink);
  }, [openLink]);

  const closeLink = () => {
    savedRange.current = null;
    setLinkHref(null);
    setLinkOpen(false);
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

  useEffect(() => {
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
  }, []);

  const block = (next: BarBlock) => {
    const root = editorRoot();
    if (!root) return;
    dispatchLineBlock(root, caret.block === next ? null : next);
  };

  const link = () => {
    const root = editorRoot();
    if (root) dispatchLinkOpen(root);
  };

  const marks: Array<{ mark: keyof TextMarks; icon: "text-bold" | "text-italic" | "text-strike"; key: "sticky.bold" | "sticky.italic" | "sticky.strike" }> = [
    { mark: "bold", icon: "text-bold", key: "sticky.bold" },
    { mark: "italic", icon: "text-italic", key: "sticky.italic" },
    { mark: "strike", icon: "text-strike", key: "sticky.strike" },
  ];

  return (
    <ObjectBar placement={placement} label={t("sticky.properties")} className="text-selection-bar">
      <div className="sb-group" role="group" aria-label={t("sticky.styles")}>
        {marks.map(({ mark, icon, key }) => {
          const label = t(key);
          return (
            <Tooltip key={mark} label={label}>
              <IconButton
                icon={icon}
                size="compact"
                label={label}
                onClick={() => formatSelection(mark)}
              />
            </Tooltip>
          );
        })}
      </div>

      <span className="sb-divider" aria-hidden="true" />

      <div className="sb-group" role="group" aria-label={t("sticky.format")}>
        <Tooltip label={t("sticky.bulletList")}>
          <IconButton
            icon="list-bullet"
            size="compact"
            label={t("sticky.bulletList")}
            selected={caret.block === "bullet"}
            onClick={() => block("bullet")}
          />
        </Tooltip>
        <Tooltip label={t("sticky.checklist")}>
          <IconButton
            icon="list-check"
            size="compact"
            label={t("sticky.checklist")}
            selected={caret.block === "check"}
            onClick={() => block("check")}
          />
        </Tooltip>
      </div>

      <span className="sb-anchor">
        <Tooltip label={t("sticky.link")}>
          <IconButton
            icon="link"
            iconSize={18}
            size="compact"
            label={t("sticky.link")}
            selected={Boolean(caret.href)}
            aria-expanded={linkOpen}
            onClick={link}
          />
        </Tooltip>
        {linkOpen && (
          <PanelWindow>
            <LinkWindow
              href={linkHref}
              canApply={Boolean(savedRange.current && (!savedRange.current.range.collapsed || linkHref))}
              onApply={applyLink}
              onRemove={removeLink}
              onClose={closeLink}
            />
          </PanelWindow>
        )}
      </span>

      <Tooltip label={t("inspector.moreActions")}>
        <IconButton
          icon="more"
          size="compact"
          label={t("inspector.moreActions")}
          aria-haspopup="dialog"
          onClick={onMore}
        />
      </Tooltip>
    </ObjectBar>
  );
}
