import { useEffect, useRef, useState } from "react";
import type { TextDeltaOp } from "@remo/model";
import { htmlFromDelta, linesOf, type LineFormatInput, type NoteDirection } from "@remo/doc";
import { useI18n } from "./i18n";
import {
  clearFormatting,
  deltaFromDom,
  deltaText,
  insertDeltaAtCaret,
  lineFormatFor,
  lineKeyAction,
  markdownShortcut,
  pasteDelta,
  selectionPayload,
  toggleMark,
  type LineBlock,
} from "./richText";
import { decodeFragment } from "./clipboard";
import { toggleEditorCode } from "./textFormatBar";
import {
  CLEAR_FORMAT_EVENT,
  INLINE_CODE_EVENT,
  LINE_BLOCK_EVENT,
  dispatchFormatChanged,
  dispatchLinkOpen,
  dispatchPasteFragment,
} from "./textFormatEvents";
import {
  applyLineFormat,
  caretAtLineEnd,
  caretAtLineStart,
  lineElementAt,
  lineElements,
  lineFormatOf,
  lineText,
  mergeLineUp,
  placeCaretAtEnd,
  placeCaretAtEndOfLine,
  placeCaretAtStart,
  removeLinePrefix,
  splitLine,
  syncLineAttributes,
} from "./textLineDom";
import { linkAtNode } from "./textFormatBar";
import { DEFAULT_EDITOR_SURFACE, DEFAULT_INK } from "./objectDefaults";

export interface EditorTarget {
  id: string;
  /** Screen-space box, so the editor sits exactly over the object. */
  rect: { left: number; top: number; width: number; height: number };
  /** Formatted text the editor opens with; marks are per character. */
  delta: TextDeltaOp[];
  /** Font size in screen pixels (already scaled by zoom). */
  fontSize: number;
  /** Inner padding in screen pixels, matching what the painter draws. */
  padding: number;
  align: "left" | "center" | "right";
  /** Vertical placement, like a sticky note; cards keep text at the top. */
  vAlign: "top" | "middle" | "bottom";
  /** Takes headings, lists and checklists (ADR-252 §2.5); a card does not. */
  richBlocks: boolean;
  fontWeight?: number;
  /**
   * Background under the text.
   *
   * The object's own fill, not white: typing on a pale yellow note inside a white
   * box hides the text you are about to write in the colour it will be painted
   * (ADR-038).
   */
  fill?: string;
  /** Text colour, the same one the painter uses. */
  ink?: string;
  /** Radius, so the editor's corners match the object it covers. */
  radius?: number;
}

/** One line the person asked to change; the caller applies them as one undo step. */
export interface LineFormatChange {
  line: number;
  format: LineFormatInput | null;
}

/**
 * Inline rich-text editor.
 *
 * A `contentEditable` element over the canvas, because real text input needs a real
 * input element and formatting needs a real selection. Every input event goes
 * straight into the shared document as a delta (the source product writes the title
 * per keystroke — ADR-016), so remote participants see typing
 * as it happens rather than on blur, and the painter draws exactly what is here.
 *
 * Since ADR-252 §5.1 a line is one `div` with its block format in `data-*`. Text changes
 * commit the whole delta; a format change alone goes through `setLineFormat` for one
 * line, so a shortcut is exactly one undo step.
 */
export function InlineEditor({
  target,
  onChange,
  onLineFormat,
  onCreateConnected,
  onClose,
  markdownShortcuts = true,
}: {
  target: EditorTarget | null;
  onChange: (id: string, delta: TextDeltaOp[]) => void;
  /** Apply line formats as one command; the board wraps them in one undo step. */
  onLineFormat?: (id: string, changes: readonly LineFormatChange[]) => void;
  /** Tab / Shift+Tab / Alt+Enter / Alt+Shift+Enter grow a chain of notes. */
  onCreateConnected?: (id: string, direction: NoteDirection) => void;
  onClose: () => void;
  /** Markdown typing rules (ADR-252 §5.2), `settings.markdownShortcuts`. */
  markdownShortcuts?: boolean;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement | null>(null);
  const [mountedFor, setMountedFor] = useState<string | null>(null);
  /** ⌘⇧V was pressed: the next `paste` takes the plain text and nothing else. */
  const plainPaste = useRef(false);
  /**
   * The last Markdown rule that fired, and the marker it replaced.
   *
   * Backspace immediately after a rule gives the marker back as text, the way Notion and
   * Google Docs behave (ADR-252 §5.2).
   */
  const lastRule = useRef<{ line: HTMLElement; marker: string } | null>(null);
  /**
   * The bar's commands, read by the listeners below.
   *
   * The bar dispatches an event on this element instead of sharing React state with the
   * editor: a button press keeps the caret in the text, and the editor runs the same
   * function its own keys do (ADR-252 §5.1, §6).
   */
  const commands = useRef<{
    block: (block: LineBlock | null) => void;
    code: () => void;
    clear: () => void;
  }>({ block: () => {}, code: () => {}, clear: () => {} });

  useEffect(() => {
    const node = ref.current;
    if (!node || !target) return;
    const onBlock = (event: Event) => {
      commands.current.block((event as CustomEvent<LineBlock | null>).detail ?? null);
    };
    const onCode = () => commands.current.code();
    const onClear = () => commands.current.clear();
    node.addEventListener(LINE_BLOCK_EVENT, onBlock);
    node.addEventListener(INLINE_CODE_EVENT, onCode);
    node.addEventListener(CLEAR_FORMAT_EVENT, onClear);
    return () => {
      node.removeEventListener(LINE_BLOCK_EVENT, onBlock);
      node.removeEventListener(INLINE_CODE_EVENT, onCode);
      node.removeEventListener(CLEAR_FORMAT_EVENT, onClear);
    };
  }, [mountedFor, target?.id]);

  // The line under the caret is the current one for a screen reader too: the format is
  // already role/aria-checked on the line, and this says which line is being read.
  useEffect(() => {
    if (!target) return;
    const update = () => {
      const node = ref.current;
      if (!node) return;
      const value = window.getSelection();
      const range = value && value.rangeCount ? value.getRangeAt(0) : null;
      const line =
        range && node.contains(range.commonAncestorContainer)
          ? lineElementAt(node, range.startContainer)
          : null;
      for (const element of lineElements(node)) {
        if (element === line) element.setAttribute("aria-current", "true");
        else element.removeAttribute("aria-current");
      }
    };
    document.addEventListener("selectionchange", update);
    update();
    return () => document.removeEventListener("selectionchange", update);
  }, [mountedFor, target?.id]);

  useEffect(() => {
    if (!target) {
      setMountedFor(null);
      return;
    }
    const node = ref.current;
    if (!node) return;

    if (mountedFor !== target.id) {
      setMountedFor(target.id);
      node.innerHTML = htmlFromDelta(target.delta);
      // Roles and `aria-checked` for the lines that have a format; the reader ignores
      // them, so the DOM still holds nothing the model cannot store (ADR-252 §9).
      syncLineAttributes(node, target.delta);
      node.focus();
      placeCaretAtEnd(node);
      lastRule.current = null;
      return;
    }

    // A remote edit while the editor is open: rewrite the DOM only when the text
    // actually differs, so the local caret is never disturbed by our own keystrokes
    // coming back through the document. A change of format alone is applied to the
    // existing divs, which keeps the caret where it was.
    const domDelta = deltaFromDom(node);
    if (deltaText(domDelta) !== deltaText(target.delta)) {
      node.innerHTML = htmlFromDelta(target.delta);
      syncLineAttributes(node, target.delta);
      placeCaretAtEnd(node);
      lastRule.current = null;
      return;
    }
    syncLineAttributes(node, target.delta);
  }, [mountedFor, target]);

  if (!target) return null;

  const { rect, fontSize, padding, align, vAlign, richBlocks, fontWeight, fill, ink, radius } = target;

  const commit = () => {
    const node = ref.current;
    if (!node) return;
    onChange(target.id, deltaFromDom(node));
  };

  /** The caret's format may have moved: the bar re-reads it instead of guessing. */
  const notifyFormat = () => {
    const node = ref.current;
    if (node) dispatchFormatChanged(node);
  };

  const selection = (): Range | null => {
    const value = window.getSelection();
    return value && value.rangeCount ? value.getRangeAt(0) : null;
  };

  const formatDocument = (changes: readonly LineFormatChange[]) => {
    if (!changes.length) return;
    // The DOM already shows the new format; the bar reads it from the caret.
    notifyFormat();
    // The editor can show one empty line more than the document holds: a plain line
    // after a formatted one is exactly the line a block format gives meaning to, so it
    // has no terminator yet (ADR-252 §2.2). Formatting it means creating it, and that
    // is a text change the delta carries — `setLineFormat` only formats lines that exist.
    const existing = linesOf(target.delta).length;
    if (changes.some((change) => change.line >= existing)) {
      commit();
      return;
    }
    if (onLineFormat) onLineFormat(target.id, changes);
    else commit();
  };

  /** The line with the caret and its index; null when the caret sits at the root. */
  const context = () => {
    const node = ref.current;
    const range = selection();
    if (!node || !range) return null;
    const line = lineElementAt(node, range.startContainer);
    if (!line) return null;
    const lines = lineElements(node);
    return { node, range, line, lines, index: lines.indexOf(line) };
  };

  /**
   * Apply a block format to the selection.
   *
   * The divs change first — that is what the person sees — and the command follows;
   * `setLineFormat` finds the same `\n`, so the two agree without a second model.
   */
  const applyBlock = (block: LineBlock | null) => {
    const node = ref.current;
    const range = selection();
    if (!node || !range) return;
    const all = lineElements(node);
    const lines = all.filter((line) => range.intersectsNode(line));
    if (!lines.length) return;
    // Mixed selection: the shortcut sets the format unless every line already has it.
    const removeAll = block != null && lines.every((line) => lineFormatOf(line)?.block === block);
    const changes: LineFormatChange[] = [];
    for (const line of lines) {
      const index = all.indexOf(line);
      if (index < 0) continue;
      const current = lineFormatOf(line);
      if (removeAll) {
        applyLineFormat(line, null);
        changes.push({ line: index, format: null });
        continue;
      }
      if (block == null) {
        if (!current) continue;
        applyLineFormat(line, null);
        changes.push({ line: index, format: null });
        continue;
      }
      if (current?.block === block) continue;
      const format = lineFormatFor(block, {
        block: current?.block ?? undefined,
        indent: current?.indent === 1 || current?.indent === 2 ? current.indent : 0,
      });
      applyLineFormat(line, format);
      // The real number arrives with the document; `1` keeps the marker visible until
      // the next render instead of a bare dot.
      if (format?.block === "ordered") line.dataset.ordinal = "1";
      changes.push({ line: index, format });
    }
    formatDocument(changes);
  };

  /** Change the level of a list line; the format is the only thing that moves. */
  const setIndent = (indent: 0 | 1 | 2) => {
    const node = ref.current;
    const range = selection();
    if (!node || !range) return;
    const line = lineElementAt(node, range.startContainer);
    if (!line) return;
    const current = lineFormatOf(line);
    if (!current?.block) return;
    const index = lineElements(node).indexOf(line);
    const format: LineFormatInput = { block: current.block, indent };
    applyLineFormat(line, format);
    formatDocument([{ line: index, format }]);
  };

  /** Drop the block format of the caret's line (Backspace at the start, Enter in an item). */
  const clearLineFormat = () => {
    const node = ref.current;
    const range = selection();
    if (!node || !range) return;
    const line = lineElementAt(node, range.startContainer);
    if (!line) return;
    const index = lineElements(node).indexOf(line);
    applyLineFormat(line, null);
    formatDocument([{ line: index, format: null }]);
  };

  /** The lines the selection touches, or the caret's line when it is collapsed. */
  const touchedLines = (node: HTMLElement, range: Range): HTMLElement[] => {
    const all = lineElements(node);
    if (range.collapsed) {
      const line = lineElementAt(node, range.startContainer);
      return line ? [line] : [];
    }
    return all.filter((line) => range.intersectsNode(line));
  };

  /** ⌘E: wrap the selection in `<code>` or unwrap it; one commit, one undo step. */
  const toggleCode = () => {
    const node = ref.current;
    if (!node) return;
    if (toggleEditorCode(node)) {
      commit();
      notifyFormat();
    }
  };

  /**
   * ⌘\ and "Clear formatting": marks and line formats both go, in one commit.
   *
   * `removeFormat` is the browser's own answer for the marks; the block formats live in
   * `data-*` on the line divs, so they are dropped here and travel to the document with
   * the same commit.
   */
  const clearSelectionFormatting = () => {
    const node = ref.current;
    const range = selection();
    if (!node || !range) return;
    clearFormatting();
    for (const line of touchedLines(node, range)) {
      if (lineFormatOf(line)) applyLineFormat(line, null);
    }
    commit();
    notifyFormat();
  };

  /** Put the characters of a rule back, so Backspace can undo what the rule did. */
  const cancelRule = () => {
    const pending = lastRule.current;
    lastRule.current = null;
    if (!pending || !pending.line.isConnected) return;
    applyLineFormat(pending.line, null);
    const text = document.createTextNode(pending.marker);
    pending.line.insertBefore(text, pending.line.firstChild);
    placeCaretAtEndOfLine(pending.line);
    // Text and format travel together, so one commit is one change to the document.
    commit();
  };

  /** Enter: a new line of the same kind, or a plain line when the item was empty. */
  const enter = () => {
    const node = ref.current;
    const range = selection();
    if (!node || !range) return;
    if (!range.collapsed) {
      range.deleteContents();
      range.collapse(true);
    }
    const line = lineElementAt(node, range.startContainer);
    if (!line) return;
    const current = lineFormatOf(line);
    // Enter at the end of a heading returns to ordinary text; a list starts another
    // item of the same kind and level (ADR-252 §5.3).
    const format: LineFormatInput | null =
      current?.block === "h1" || current?.block === "h2"
        ? null
        : current?.block
          ? {
              block: current.block,
              ...(current.indent === 1 || current.indent === 2 ? { indent: current.indent } : {}),
            }
          : null;
    splitLine(line, range, format);
    commit();
  };

  const markdownAtCaret = (node: HTMLElement): boolean => {
    if (!markdownShortcuts || !richBlocks) return false;
    const range = selection();
    if (!range) return false;
    const line = lineElementAt(node, range.startContainer);
    if (!line || !caretAtLineEnd(range, line)) return false;
    const text = lineText(line);
    const rule = markdownShortcut(text, { enabled: markdownShortcuts });
    if (!rule) return false;
    const current = lineFormatOf(line);
    const format: LineFormatInput = {
      block: rule.block,
      // A marker typed in a nested list stays at that level.
      ...(current?.block && current.indent === 1 ? { indent: 1 as const } : {}),
      ...(current?.block && current.indent === 2 ? { indent: 2 as const } : {}),
      ...(rule.checked ? { checked: true } : {}),
    };
    const marker = text.slice(0, rule.remove);
    removeLinePrefix(line, rule.remove);
    applyLineFormat(line, format);
    if (rule.block === "ordered") line.dataset.ordinal = "1";
    lastRule.current = { line, marker };
    placeCaretAtStart(line);
    commit();
    notifyFormat();
    return true;
  };

  // The listeners above read this on every bar command; the bar cannot call the editor
  // directly without a shared state neither of them should own.
  commands.current = { block: applyBlock, code: toggleCode, clear: clearSelectionFormatting };

  return (
    <div
      className="inline-editor"
      contentEditable
      suppressContentEditableWarning
      ref={ref}
      role="textbox"
      aria-multiline="true"
      aria-label={t("canvas.editText")}
      spellCheck={false}
      dir="auto"
      style={{
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        fontSize,
        fontWeight,
        textAlign: align,
        // Matches the painted metrics (line height is 1.25 of the font) so the caret
        // sits where the drawn text is.
        lineHeight: 1.25,
        padding,
        justifyContent: vAlign === "top" ? "flex-start" : vAlign === "bottom" ? "flex-end" : "center",
        background: fill ?? DEFAULT_EDITOR_SURFACE,
        color: ink ?? DEFAULT_INK,
        borderRadius: radius ?? 3,
      }}
      onInput={() => {
        const node = ref.current;
        if (node && markdownAtCaret(node)) return;
        lastRule.current = null;
        commit();
        notifyFormat();
      }}
      onPaste={(event) => {
        // The browser never inserts its own clipboard markup: what arrives here has
        // passed the white list, and the document is the only thing that decides what a
        // note can hold (ADR-252 §1, rule 3).
        event.preventDefault();
        event.stopPropagation();
        const node = ref.current;
        const data = event.clipboardData;
        const text = data?.getData("text/plain") || null;
        const plain = plainPaste.current;
        plainPaste.current = false;
        // Our own board fragment is objects, not characters: the note keeps its text
        // and the objects land beside it (§5.4.2). The payload is the JSON in
        // `text/plain`, the one name the transport has.
        if (node && text && decodeFragment(text)) {
          dispatchPasteFragment(node);
          return;
        }
        const delta = pasteDelta({
          html: data?.getData("text/html") || null,
          text,
          plain,
        });
        if (!node || !delta.length) return;
        // A paste with no caret inside the editor (a click on its edge) appends.
        if (!insertDeltaAtCaret(delta, node)) {
          placeCaretAtEnd(node);
          insertDeltaAtCaret(delta, node);
        }
        commit();
      }}
      onCopy={(event) => {
        // HTML for other applications, Markdown for a chat: the two halves of §5.5.
        const node = ref.current;
        const payload = node ? selectionPayload(node) : null;
        if (!payload) return;
        event.preventDefault();
        event.clipboardData?.setData("text/html", payload.html);
        event.clipboardData?.setData("text/plain", payload.text);
      }}
      onCut={(event) => {
        const node = ref.current;
        const payload = node ? selectionPayload(node) : null;
        if (!payload) return;
        event.preventDefault();
        event.clipboardData?.setData("text/html", payload.html);
        event.clipboardData?.setData("text/plain", payload.text);
        window.getSelection()?.deleteFromDocument();
        commit();
      }}
      onKeyDown={(event) => {
        const node = ref.current;
        if (!node) return;
        const range = selection();
        const active = context();
        const line = active?.line ?? null;
        const format = line ? lineFormatOf(line) : null;
        const action = lineKeyAction({
          key: event.key,
          code: event.code,
          meta: event.metaKey || event.ctrlKey,
          shift: event.shiftKey,
          alt: event.altKey,
          richBlocks,
          block: format?.block ?? undefined,
          indent: format?.indent === 1 || format?.indent === 2 ? format.indent : 0,
          atStart: Boolean(range && line && caretAtLineStart(range, line)),
          empty: line ? lineText(line) === "" : true,
          hasPrevious: (active?.index ?? 0) > 0,
          rulePending: Boolean(line && lastRule.current?.line === line),
        });

        switch (action.type) {
          case "close": {
            event.preventDefault();
            // ⌘Enter on a link opens it; on anything else it closes the editor. Enter
            // alone never navigates, so typing a line with a link is not interrupted.
            const link =
              event.key === "Enter" && (event.metaKey || event.ctrlKey) && range
                ? linkAtNode(range.startContainer, node)
                : null;
            if (link?.href) window.open(link.href, "_blank", "noopener,noreferrer");
            else onClose();
            return;
          }
          case "link":
            event.preventDefault();
            dispatchLinkOpen(node);
            return;
          case "code":
            event.preventDefault();
            toggleCode();
            return;
          case "plainPaste":
            // Let the browser fire `paste`; the flag makes it text-only (§5.4).
            plainPaste.current = true;
            event.stopPropagation();
            return;
          case "stay":
            // A key that belongs to the editor but has nothing to do here: Tab on a
            // heading must not move focus out and close the editor.
            event.preventDefault();
            return;
          case "mark":
            event.preventDefault();
            toggleMark(action.mark);
            commit();
            return;
          case "clearFormatting":
            event.preventDefault();
            event.stopPropagation();
            clearSelectionFormatting();
            return;
          case "toggleBlock":
          case "setBlock":
            event.preventDefault();
            applyBlock(action.block);
            return;
          case "newBullet":
            event.preventDefault();
            applyBlock("bullet");
            return;
          case "indent":
            event.preventDefault();
            setIndent(action.indent);
            return;
          case "enter":
            // No top-level line means the browser owns the content (a `fill` or an
            // engine inserting a bare text node): let it make the div.
            if (!line) break;
            event.preventDefault();
            if (action.exitList) clearLineFormat();
            else enter();
            return;
          case "clearLine":
            event.preventDefault();
            clearLineFormat();
            return;
          case "mergeUp": {
            event.preventDefault();
            if (!line) return;
            const previous = active?.lines[(active.index ?? 0) - 1];
            if (previous) mergeLineUp(line, previous);
            commit();
            return;
          }
          case "cancelRule":
            event.preventDefault();
            cancelRule();
            return;
          case "chain":
            event.preventDefault();
            commit();
            onCreateConnected?.(target.id, action.direction);
            return;
          case "none":
            break;
        }

        // Any other key gives up a pending ⌘⇧V, so a stale flag cannot eat a later paste.
        plainPaste.current = false;
        // Keep canvas shortcuts (undo/redo/delete) out of the text field.
        event.stopPropagation();
      }}
      onBlur={(event) => {
        // The link field is the one control outside the text that must keep the editor
        // open: moving focus there is how an address is typed.
        const next = event.relatedTarget as Node | null;
        if (next instanceof Element && next.closest(".link-window")) return;
        onClose();
      }}
    />
  );
}
