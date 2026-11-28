/**
 * Text for the command layer (ADR-252 §11 stage 7).
 *
 * A command receives text either as plain `content` or as `markdown`; this module is
 * the one place that turns the second into the delta the document stores, and the one
 * place that decides between a plain `Y.Text` and a formatted `Y.XmlText`. It is split
 * out of `commands.mjs` because the registry is about permission and validation, and
 * text storage is a rule with its own tests.
 */
import {
  cleanMarkdown,
  displayTextOf,
  insertionOps,
  isRichDelta,
  parseMarkdown,
} from "@remo/text";
import { Y } from "./y.mjs";

/** Kinds that hold text at all (a line's label counts — ADR-041). */
export const TEXT_TYPES = new Set(["sticky_note", "text", "shape", "card", "connector"]);

/**
 * Kinds that take the whole rich-text model: headings, lists, checklists and links
 * (ADR-252). A connector label takes inline marks only and a card stays plain, so
 * Markdown is refused there rather than silently flattened.
 */
export const MARKDOWN_TYPES = new Set(["sticky_note", "text", "shape"]);

function texts(ydoc) {
  return ydoc.getMap("texts");
}

/** Replace a widget's text in place; a plain `Y.Text` keeps the cheap merge. */
export function replaceText(ydoc, id, value, key = id) {
  const store = texts(ydoc);
  const current = store.get(key);
  if (current && typeof current.delete === "function") {
    current.delete(0, current.length);
    current.insert(0, value);
    return;
  }
  const created = new Y.Text();
  created.insert(0, value);
  store.set(key, created);
}

/** Seed the text of a new widget, when there is any. */
export function seedText(ydoc, widget, value, key = widget.id) {
  if (!TEXT_TYPES.has(widget.type) || !value) return;
  const created = new Y.Text();
  created.insert(0, value);
  texts(ydoc).set(key, created);
}

/**
 * Markdown from a command input to the delta the document stores.
 *
 * The content is foreign — an integration token, a caller's own paste — so HTML is
 * stripped before the dialect reads it: the document holds characters and marks, never
 * markup.
 */
export function markdownDelta(markdown) {
  return parseMarkdown(cleanMarkdown(markdown));
}

/** The shared `Y.XmlText` a delta is written into, created on first use. */
function xmlTextFor(ydoc, id, key = id) {
  const store = texts(ydoc);
  const current = store.get(key);
  if (current instanceof Y.XmlText) {
    current.delete(0, current.length);
    return current;
  }
  const created = new Y.XmlText();
  // The type must be in the document before anything is inserted into it.
  store.set(key, created);
  return created;
}

/**
 * Seed the text of a new widget from a delta.
 *
 * A delta with no mark and no block stays a plain `Y.Text`, so an old client and the
 * plain painter see exactly what they always saw (ADR-252, rule 2). An empty delta
 * leaves the widget with no shared text at all, as a plain empty widget has.
 */
export function seedTextDelta(ydoc, widget, delta, key = widget.id) {
  if (!delta.length) return;
  if (!isRichDelta(delta)) {
    seedText(ydoc, widget, displayTextOf(delta), key);
    return;
  }
  xmlTextFor(ydoc, widget.id, key).applyDelta(insertionOps(delta));
}

/** Replace a widget's whole text with a delta; an empty one clears it. */
export function replaceTextDelta(ydoc, id, delta, key = id) {
  if (!isRichDelta(delta)) {
    replaceText(ydoc, id, displayTextOf(delta), key);
    return;
  }
  xmlTextFor(ydoc, id, key).applyDelta(insertionOps(delta));
}
