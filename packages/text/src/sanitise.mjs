/**
 * The writing boundary for untrusted Markdown (ADR-252 §11 stage 7, ADR-253).
 *
 * The document stores a delta, never markup. `parseMarkdown` already refuses to build
 * markup out of a tag it does not know — the tag stays literal characters — but a
 * command input and a plan step are *authored* by somebody else, so a foreign tag is
 * removed rather than shown: nothing that looks like HTML should reach a board.
 *
 * The two jobs are deliberately different: a reader is permissive and a writer is not.
 */

/** Elements whose content is never a person's text. */
const DROPPED_WITH_CONTENT =
  /<(script|style|iframe|object|embed|svg|math|template|noscript|head|title)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const ANY_TAG = /<\/?([a-z][a-z0-9:-]*)\b[^>]*>/gi;
/** A Markdown autolink (`<https://…>`, `<mailto:…>`) is not an HTML tag. */
const AUTOLINK = /^<[a-z][a-z0-9+.-]*:/i;
/** Exactly the six inline tags the dialect reads as marks. */
const KEPT_INLINE_TAG = /^<\/?(?:b|strong|i|em|s|del|u|ins|code)>$/i;

/**
 * Remove every tag except a balanced pair of the six inline tags the dialect reads.
 *
 * An opening tag without its close, a close without its opening and a tag with
 * attributes are all removed: `parseMarkdown` would keep those as literal characters,
 * and this boundary leaves no markup in the document at all.
 */
function stripTags(text) {
  const parts = [];
  let index = 0;
  for (const match of text.matchAll(ANY_TAG)) {
    if (match.index > index) parts.push({ text: text.slice(index, match.index) });
    const tag = match[0];
    const autolink = AUTOLINK.test(tag);
    parts.push({
      tag,
      name: match[1].toLowerCase(),
      closing: tag.startsWith("</"),
      allowed: !autolink && KEPT_INLINE_TAG.test(tag),
      // An autolink is Markdown (`<https://…>`), not markup, and stays as characters.
      keep: autolink,
    });
    index = match.index + tag.length;
  }
  if (index < text.length) parts.push({ text: text.slice(index) });

  const open = new Map();
  for (const part of parts) {
    if (!part.tag || !part.allowed) continue;
    if (!part.closing) {
      const stack = open.get(part.name) ?? [];
      stack.push(part);
      open.set(part.name, stack);
      continue;
    }
    const matched = open.get(part.name)?.pop();
    if (!matched) {
      part.allowed = false;
      continue;
    }
    matched.keep = true;
    part.keep = true;
  }

  return parts.map((part) => (part.tag ? (part.keep ? part.tag : "") : part.text)).join("");
}

/**
 * Strip HTML from Markdown an untrusted author wrote.
 *
 * `<script>` and its kind go with their content, an HTML comment goes, and every other
 * foreign tag loses only the tag, as a Markdown viewer shows it. The six inline tags the
 * dialect understands stay (a balanced pair only) and become marks in `parseMarkdown`.
 *
 * An escaped tag (`\<b>`) is a tag here too: the boundary is strict on purpose, because
 * a model can never mean to type HTML at a person.
 */
export function cleanMarkdown(source) {
  let text = source.replace(/<!--[\s\S]*?(?:-->|$)/g, "");
  for (let round = 0; round < 3; round += 1) {
    const before = text;
    text = text.replace(DROPPED_WITH_CONTENT, "");
    if (text === before) break;
  }
  return stripTags(text);
}
