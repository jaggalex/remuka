import * as Y from "yjs";
import {
  kindOf,
  type LineFormat,
  type TextDeltaOp,
  type TextLine,
  type TextMarks,
  type TextRun,
  type Widget,
} from "@remo/model";
import {
  canonicalLineFormat,
  canonicalMarks,
  hasMarks,
  insertionAttributes,
  insertionOps,
  isRichDelta,
  linesOf,
  marksKey,
  normalizeDelta,
  plainTextOf,
} from "@remo/text";
import type { BoardDocument } from "./board";
import { LOCAL_ORIGIN } from "./origins";
import { growFramesAround } from "./frameGrowth";

/**
 * Text: storage, formatting and the commands that change it.
 *
 * Split out of `board.ts` because it is a feature with its own rules — `Y.XmlText`
 * versus `Y.Text`, marks per character, the line-height and fit rules — and because
 * the document class had grown into the place where everything lived (ADR-053).
 *
 * The value rules themselves — canonical attributes, `linesOf`, the Markdown dialect —
 * live in `@remo/text`, because the sync service and the agent contract run the same
 * code without a build step (ADR-252 §11 stage 7). This module owns the document side:
 * Yjs storage and the commands that write it.
 *
 * Nothing here imports the document module at runtime: `BoardDocument` is a type, and
 * the commands receive an instance. That keeps the dependency one-way.
 */

// The document's public surface keeps the names callers already import from
// `@remo/doc`; the implementation is the shared package.
export {
  canonicalAttributes,
  canonicalLineFormat,
  canonicalMarks,
  displayTextOf,
  hasMarks,
  insertionAttributes,
  insertionOps,
  isRichDelta,
  linesOf,
  marksKey,
  normalizeDelta,
  plainTextOf,
} from "@remo/text";

/* ------------------------------------------------------------- formatting -- */

/** Widget text lives in `Y.Text` (or `Y.XmlText`); painting reads it from there. */
export function withMaterializedText(
  widget: Widget,
  text: string,
  runs: TextRun[] | undefined,
  lines?: TextLine[],
): Widget {
  // `runs` is absent for plain text, so ordinary notes keep the plain painter and
  // exactly the layout they had before rich text. `lines` appears only when a block
  // format exists, so old text never takes the block layout (ADR-252, rule 2).
  const formatted = {
    ...(runs?.some(hasMarks) ? { runs } : {}),
    ...(lines?.some((line) => line.block) ? { lines } : {}),
  } as Partial<Pick<Widget, "runs" | "lines">>;
  const next = (field: "content" | "title"): Widget => {
    // Derived fields are rebuilt from the shared text, never trusted from the wire.
    const copy = { ...widget, [field]: text } as Widget;
    delete copy.runs;
    delete copy.lines;
    return Object.assign(copy, formatted);
  };
  if (widget.type === "text" || widget.type === "sticky_note" || widget.type === "shape") {
    return next("content");
  }
  if (widget.type === "card") return next("title");
  if (widget.type === "connector") return next("content");
  return widget;
}

/**
 * Plain text of a shared text value.
 *
 * `Y.XmlText.toString()` serializes tags (`<bold>Hello</bold>`), so it must never be
 * used for display; the delta is the only honest source.
 */
export function plainOf(text: Y.Text): string {
  if (text instanceof Y.XmlText) {
    return text
      .toDelta()
      .map((op: { insert?: unknown }) => (typeof op.insert === "string" ? op.insert : ""))
      .join("");
  }
  return text.toString();
}

/** Rich-text delta of a shared text value. Plain text is a one-op delta. */
export function deltaOf(text: Y.Text): TextDeltaOp[] {
  if (text instanceof Y.XmlText) {
    return text
      .toDelta()
      .filter((op: { insert?: unknown }) => typeof op.insert === "string")
      .map((op: { insert?: unknown; attributes?: unknown }) => {
        const attributes = op.attributes as TextMarks | undefined;
        return {
          insert: op.insert as string,
          ...(attributes && Object.keys(attributes).length ? { attributes } : {}),
        };
      });
  }
  const plain = text.toString();
  return plain ? [{ insert: plain }] : [];
}

/**
 * Runs for the painter, or undefined when nothing is formatted.
 *
 * Adjacent operations with the same marks are merged, so the painter draws one
 * segment where the delta has several.
 */
export function runsOf(text: Y.Text): TextRun[] | undefined {
  if (!(text instanceof Y.XmlText)) return undefined;

  const runs: TextRun[] = [];
  for (const op of deltaOf(text)) {
    if (!op.insert) continue;
    // Only inline marks belong in a run; a line format on `\n` is a line's, not a run's.
    const marks = canonicalMarks(op.attributes);
    const last = runs[runs.length - 1];
    if (last && sameMarks(last, marks)) {
      last.text += op.insert;
      continue;
    }
    runs.push({ text: op.insert, ...marks });
  }
  return runs.some(hasMarks) ? runs : undefined;
}

function sameMarks(run: TextRun, marks: TextMarks): boolean {
  return marksKey(run) === marksKey(marks);
}

/**
 * Widget types that carry text.
 *
 * Their shared text is created when the widget is, not on the first keystroke: if two
 * clients type into the same note before either has the shared text, both create a
 * `Y.Text` and Yjs keeps only one of them — the other client's typing is discarded.
 * Creating it up front makes the two creations content-identical, so the race is
 * harmless.
 */
/**
 * Whether this kind of object holds text (a line's label counts — ADR-041).
 *
 * The answer lives in the capability table, because the painter, the editor and the
 * style commands all have to agree on it (ADR-049).
 */
export function holdsText(widget: Widget): boolean {
  return kindOf(widget.type).text;
}

export function seedTextField(board: BoardDocument, widget: Widget, importText: string): void {
  if (!holdsText(widget) || board.texts.has(widget.id)) return;
  const shared = new Y.Text();
  if (importText) shared.insert(0, importText);
  board.texts.set(widget.id, shared);
}

/**
 * Seed a widget's shared text with a formatted delta.
 *
 * Used when the text arrives already formatted — an agent's Markdown plan or a command's
 * `markdown` field (ADR-252 §11 stage 7). The caller owns the transaction, so a whole
 * plan is still one undo step. A delta with no attribute is plain text and belongs in
 * `seedTextField`, which keeps the old `Y.Text` path.
 */
export function seedTextDelta(
  board: BoardDocument,
  widget: Widget,
  delta: readonly TextDeltaOp[],
): void {
  if (!holdsText(widget) || board.texts.has(widget.id)) return;
  const shared = new Y.XmlText();
  // The type must be in the document before anything is inserted into it.
  board.texts.set(widget.id, shared);
  shared.applyDelta(insertionOps(delta));
}


/* --------------------------------------------------------------- text ops --- */

/** What a command may ask a line to become; `null` clears the format. */
export interface LineFormatInput {
  block?: LineFormat["block"] | null;
  indent?: 0 | 1 | 2 | null;
  checked?: boolean | null;
}

interface MarkedChar {
  ch: string;
  key: string;
  attributes: TextMarks & LineFormat;
}

function charsOf(delta: readonly TextDeltaOp[]): MarkedChar[] {
  const chars: MarkedChar[] = [];
  for (const op of delta) {
    // Canonicalising once per operation, not once per character: a long link must not
    // be URL-parsed for every code point.
    const marks = canonicalMarks(op.attributes);
    const line = canonicalLineFormat(op.attributes);
    for (const ch of op.insert) {
      const attributes = ch === "\n" ? line : marks;
      chars.push({ ch, key: marksKey(attributes), attributes });
    }
  }
  return chars;
}

/** The shared text value as `Y.XmlText`, upgrading a plain one in place. */
function ensureXmlText(board: BoardDocument, id: string, plain: string): Y.XmlText {
  const existing = board.texts.get(id);
  if (existing instanceof Y.XmlText) return existing;

  // Lazy migration: a note that never had formatting keeps its `Y.Text` until the
  // first mark arrives, at which point the value is replaced by an `Y.XmlText` that
  // carries the same text. Must run inside a transaction, and the type must be in
  // the document before anything is inserted into it.
  const text = new Y.XmlText();
  board.texts.set(id, text);
  if (plain) text.insert(0, plain, {});
  return text;
}

/**
 * Set a widget's formatted text.
 *
 * The editor sends the whole delta on every input event; this reconciles it against
 * what the document already holds as a common-prefix / common-suffix diff, so two
 * people typing in the same note merge character-wise instead of overwriting each
 * other. A delta with no marks and no shared rich text is a plain edit and takes the
 * plain path, which keeps the cheap `Y.Text` merge and the existing height growth.
 */
export function setWidgetDelta(
  board: BoardDocument,
  id: string,
  delta: readonly TextDeltaOp[],
  options: { height?: number | null } = {},
): void {
  const widget = board.readWidget(id);
  if (!widget || widget.locked) return;

  const next = normalizeDelta(delta);
  const existing = board.texts.get(id);

  if (!isRichDelta(next) && !(existing instanceof Y.XmlText)) {
    setWidgetText(board, id, plainTextOf(next), options);
    return;
  }

  const current = board.deltaOf(id);
  const heightDiffers =
    options.height != null && Math.abs(widget.height - options.height) > 0.5;

  board.transact(() => {
    if (heightDiffers && options.height != null) {
      const live = board.readWidget(id);
      if (live) {
        board.widgets.set(id, { ...live, height: options.height });
        // A shape that grew for its text grows its frame too (ADR-243).
        growFramesAround(board, id);
      }
    }

    const text = ensureXmlText(board, id, plainTextOf(current));
    const currentChars = charsOf(current);
    const nextChars = charsOf(next);

    let prefix = 0;
    const maxPrefix = Math.min(currentChars.length, nextChars.length);
    while (prefix < maxPrefix && sameChar(currentChars[prefix]!, nextChars[prefix]!)) prefix += 1;

    let suffix = 0;
    const maxSuffix = Math.min(currentChars.length - prefix, nextChars.length - prefix);
    while (
      suffix < maxSuffix &&
      sameChar(
        currentChars[currentChars.length - 1 - suffix]!,
        nextChars[nextChars.length - 1 - suffix]!,
      )
    ) {
      suffix += 1;
    }

    // `charsOf` yields code points, so the diff counts are not the UTF-16 offsets
    // `Y.XmlText` expects. Convert before touching the shared text; an emoji is two
    // code units, and using the code-point count cut the string in the wrong place.
    const prefixOffset = utf16Length(currentChars, 0, prefix);
    const removeLength = utf16Length(currentChars, prefix, currentChars.length - suffix);
    if (removeLength > 0) text.delete(prefixOffset, removeLength);

    // Insert the changed middle, one run per set of marks. Marks are explicit so a
    // plain run is not silently painted with the formatting to its left.
    const end = nextChars.length - suffix;
    let index = prefixOffset;
    let i = prefix;
    while (i < end) {
      const key = nextChars[i]!.key;
      const attributes = nextChars[i]!.attributes;
      let value = "";
      while (i < end && nextChars[i]!.key === key) {
        value += nextChars[i]!.ch;
        i += 1;
      }
      text.insert(index, value, insertionAttributes(attributes));
      index += value.length;
    }
  }, LOCAL_ORIGIN, { merge: true });
}

/**
 * Change the format of one line, cheaply (ADR-252 §2.3).
 *
 * Only the `\n` that ends the line is formatted, so the update merges with concurrent
 * typing the way any other character edit does. When the last line has no terminating
 * `\n` (the ordinary plain case), one is added in the same transaction; clearing that
 * format removes it again, so the text returns exactly to what it was.
 */
export function setLineFormat(
  board: BoardDocument,
  id: string,
  lineIndex: number,
  format: LineFormatInput | null,
): void {
  const widget = board.readWidget(id);
  if (!widget || widget.locked || !kindOf(widget.type).richBlocks) return;

  const next = canonicalLineFormat(format ?? undefined);
  const clearing = Object.keys(next).length === 0;
  // An unknown or incomplete format (a block this build does not know, `checked`
  // without `check`, indent without a list) is ignored, not read as "clear it".
  const requested = format != null && Object.values(format).some((value) => value != null);
  if (clearing && requested) return;
  const delta = board.deltaOf(id);
  const lines = linesOf(delta);
  if (!Number.isInteger(lineIndex) || lineIndex < 0 || lineIndex >= lines.length) return;

  const line = lines[lineIndex]!;
  // Clearing a line that has no format asks for nothing, and an identical format must
  // not create an undo step.
  if (clearing && !line.block) return;
  const unchanged =
    (line.block ?? undefined) === next.block &&
    line.indent === (next.indent ?? 0) &&
    line.checked === (next.checked === true);
  if (unchanged) return;

  const plain = plainTextOf(delta);
  let newline = -1;
  let seen = 0;
  for (let index = 0; index < plain.length; index += 1) {
    if (plain[index] !== "\n") continue;
    if (seen === lineIndex) {
      newline = index;
      break;
    }
    seen += 1;
  }

  // A line without a terminating newline is the last line: a format needs one, and a
  // clear has nothing to clear.
  if (newline < 0) {
    if (clearing) return;
    board.transact(() => {
      const text = ensureXmlText(board, id, plain);
      text.insert(text.length, "\n", insertionAttributes(next));
    });
    return;
  }

  // The terminating newline of a formatted last line exists only for that format. A
  // clear deletes it, so plain text stays plain rather than gaining an empty line.
  if (clearing && newline === plain.length - 1) {
    board.transact(() => {
      const text = ensureXmlText(board, id, plain);
      text.delete(newline, 1);
    });
    return;
  }

  board.transact(() => {
    const text = ensureXmlText(board, id, plain);
    text.format(newline, 1, insertionAttributes(next));
  });
}

function sameChar(a: MarkedChar, b: MarkedChar): boolean {
  return a.ch === b.ch && a.key === b.key;
}

/** UTF-16 length of a run of marked characters, the unit `Y.XmlText` indexes in. */
function utf16Length(chars: readonly MarkedChar[], from = 0, to = chars.length): number {
  let length = 0;
  for (let i = from; i < to; i += 1) length += chars[i]!.ch.length;
  return length;
}

/**
 * Set a widget's text.
 *
 * Applied as a prefix/suffix diff so two people typing in the same note merge
 * character-wise instead of overwriting each other's paragraph. One transaction per
 * call: the editor calls this on every keystroke, and Yjs streams that update.
 */
export function setWidgetText(
  board: BoardDocument,
  id: string,
  value: string,
  options: { height?: number | null } = {},
): void {
  const widget = board.readWidget(id);
  if (!widget || widget.locked) return;

  const sharedText = board.texts.get(id);
  const currentText = sharedText ? plainOf(sharedText) : (widget.title ?? widget.content ?? "");
  const textDiffers = currentText !== value;
  const heightDiffers =
    options.height != null && Math.abs(widget.height - options.height) > 0.5;

  // Nothing to do: do not create a shared text or an undo step for a no-op.
  if (!textDiffers && !heightDiffers) return;

  // Merged: consecutive keystrokes are one undo step, bounded by the editor's own
  // stopCapturing() calls when it opens and closes.
  board.transact(() => {
    // Note-like widgets grow with their text. The caller measures (font metrics
    // need a canvas), and the resize rides along in the same merged transaction so
    // an editing session is still one undo step.
    if (heightDiffers && options.height != null) {
      const live = board.readWidget(id);
      if (live) {
        board.widgets.set(id, { ...live, height: options.height });
        // A shape that grew for its text grows its frame too (ADR-243).
        growFramesAround(board, id);
      }
    }

    if (!textDiffers) return;

    let text = board.texts.get(id);
    if (!text) {
      text = new Y.Text();
      board.texts.set(id, text);
      if (currentText) text.insert(0, currentText);
    }

    const current = plainOf(text);
    let prefix = 0;
    const maxPrefix = Math.min(current.length, value.length);
    while (prefix < maxPrefix && current[prefix] === value[prefix]) prefix += 1;

    let suffix = 0;
    const maxSuffix = Math.min(current.length - prefix, value.length - prefix);
    while (
      suffix < maxSuffix &&
      current[current.length - 1 - suffix] === value[value.length - 1 - suffix]
    ) {
      suffix += 1;
    }

    const removeLength = current.length - prefix - suffix;
    if (removeLength > 0) text.delete(prefix, removeLength);
    const insertValue = value.slice(prefix, value.length - suffix);
    if (insertValue) text.insert(prefix, insertValue);
  }, LOCAL_ORIGIN, { merge: true });
}


export function setNoteFontSize(board: BoardDocument, ids: string[], fontSize: number | null): void {
  board.transact(() => {
    for (const id of ids) {
      const widget = board.readWidget(id);
      if (!widget || !holdsText(widget)) continue;
      if (widget.locked) continue;
      const style = { ...widget.style };
      if (fontSize == null) delete style.fontSize;
      else style.fontSize = Math.max(6, Math.min(96, Math.round(fontSize)));
      board.widgets.set(id, { ...widget, style });
    }
  });
}

/** Horizontal text alignment inside the note. */
export function setNoteTextAlign(
  board: BoardDocument,
  ids: string[],
  align: "left" | "center" | "right",
): void {
  board.transact(() => {
    for (const id of ids) {
      const widget = board.readWidget(id);
      if (!widget || !holdsText(widget)) continue;
      if (widget.locked) continue;
      board.widgets.set(id, { ...widget, style: { ...widget.style, textAlign: align } });
    }
  });
}

/** Vertical text alignment inside the note. */
export function setNoteTextVAlign(
  board: BoardDocument,
  ids: string[],
  vAlign: "top" | "middle" | "bottom",
): void {
  board.transact(() => {
    for (const id of ids) {
      const widget = board.readWidget(id);
      if (!widget || !holdsText(widget)) continue;
      if (widget.locked) continue;
      board.widgets.set(id, { ...widget, style: { ...widget.style, textVAlign: vAlign } });
    }
  });
}

/** Marks that every character of a note carries, or null when they differ. */
export function noteMarksOf(board: BoardDocument, id: string): TextMarks | null {
  const chars: TextMarks[] = [];
  for (const op of board.deltaOf(id)) {
    const marks = canonicalMarks(op.attributes);
    // A line format lives on the newline and carries no inline mark; the bar is about
    // text, so a multi-line note can still report "all bold".
    for (const ch of op.insert) {
      if (ch !== "\n") chars.push(marks);
    }
  }
  if (!chars.length) return {};
  const first = chars[0]!;
  for (const marks of chars) {
    for (const key of ["bold", "italic", "underline", "strike", "code", "href"] as const) {
      if (first[key] !== marks[key]) return null;
    }
  }
  return { ...first };
}

/**
 * Toggle one mark on the whole note.
 *
 * The toolbar's B/I/U/S act on the note, not on a selection: while the editor is
 * closed there is no caret, and "make this note bold" is what the button means
 * (ADR-027). Inside the editor the same keys still format only the selection.
 */
export function toggleNoteMark(
  board: BoardDocument,
  ids: string[],
  mark: keyof TextMarks,
): void {
  // A link is not a toggle: the bar opens the link dialog for it (ADR-252 §5.3).
  if (mark === "href") return;
  for (const id of ids) {
    if (board.readWidget(id)?.locked) continue;
    const current = noteMarksOf(board, id);
    if (current == null) continue;
    const next: TextMarks = { ...current };
    if (next[mark]) delete next[mark];
    else next[mark] = true;

    const delta: TextDeltaOp[] = board.deltaOf(id).map((op) => {
      const attributes = { ...(op.attributes ?? {}), ...next };
      if (!next.bold) delete attributes.bold;
      if (!next.italic) delete attributes.italic;
      if (!next.underline) delete attributes.underline;
      if (!next.strike) delete attributes.strike;
      if (!next.code) delete attributes.code;
      return Object.keys(attributes).length
        ? { insert: op.insert, attributes }
        : { insert: op.insert };
    });
    setWidgetDelta(board, id, delta);
  }
}


export function clearContent(board: BoardDocument, ids: readonly string[]): void {
  board.transact(() => {
    for (const id of ids) {
      const widget = board.readWidget(id);
      if (!widget) continue;
      if (widget.type === "card") {
        board.widgets.set(id, { ...widget, title: "" });
        const text = board.texts.get(id);
        if (text) text.delete(0, plainOf(text).length);
        continue;
      }
      if (!holdsText(widget)) continue;
      if (board.deltaOf(id).length) setWidgetDelta(board, id, []);
      board.widgets.set(id, { ...widget, content: "", title: "" });
    }
  });
}

