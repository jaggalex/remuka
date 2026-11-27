import { useEffect, useState } from "react";
import { Button, IconButton } from "@remo/ui";
import { useI18n } from "../i18n";
import { toggleMark as toggleMarkInDom } from "../richText";
import {
  editorFormat,
  editorRoot,
  type BarBlock,
  type EditorFormat,
} from "../textFormatBar";
import {
  FORMAT_CHANGED_EVENT,
  dispatchClearFormatting,
  dispatchInlineCode,
  dispatchLineBlock,
} from "../textFormatEvents";

const NO_FORMAT: EditorFormat = { block: null, href: null, code: false };

/**
 * The rest of the text formats, in the properties panel (T8, `spec/tidy-desk.md` §10a).
 *
 * The bar keeps the six controls used while typing; headings, numbering, code, underline
 * and "clear format" live behind «⋯». Buttons suppress the pointer's focus change, so the
 * editor keeps its caret and the same DOM functions the bar uses run here too — one
 * mechanism, two places it is shown.
 */
export function TextMoreControls() {
  const { t } = useI18n();
  const [caret, setCaret] = useState<EditorFormat>(NO_FORMAT);

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
    if (root) dispatchLineBlock(root, caret.block === next ? null : next);
  };

  const underline = () => {
    toggleMarkInDom("underline");
    const node = document.querySelector<HTMLElement>(".inline-editor");
    if (node) node.dispatchEvent(new Event("input", { bubbles: true }));
  };

  const code = () => {
    const root = editorRoot();
    if (root) dispatchInlineCode(root);
  };

  const clear = () => {
    const root = editorRoot();
    if (root) dispatchClearFormatting(root);
  };

  return (
    <div
      className="properties-text-more"
      role="group"
      aria-label={t("sticky.format")}
      onPointerDown={(event) => event.preventDefault()}
    >
      <Button
        variant="ghost"
        size="compact"
        aria-label={t("sticky.underline")}
        selected={false}
        onClick={underline}
      >
        U
      </Button>
      <Button
        variant="ghost"
        size="compact"
        aria-label={t("sticky.heading1")}
        selected={caret.block === "h1"}
        onClick={() => block("h1")}
      >
        H1
      </Button>
      <Button
        variant="ghost"
        size="compact"
        aria-label={t("sticky.heading2")}
        selected={caret.block === "h2"}
        onClick={() => block("h2")}
      >
        H2
      </Button>
      <Button
        variant="ghost"
        size="compact"
        aria-label={t("sticky.numberedList")}
        selected={caret.block === "ordered"}
        onClick={() => block("ordered")}
      >
        <span className="properties-format-icon">1.</span>
      </Button>
      <IconButton
        icon="code"
        size="compact"
        label={t("sticky.inlineCode")}
        selected={caret.code}
        onClick={code}
      />
      <Button variant="ghost" size="compact" icon="clear-format" onClick={clear}>
        {t("sticky.clearFormatting")}
      </Button>
    </div>
  );
}
