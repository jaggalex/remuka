/**
 * The rich-text value model: canonical attributes, deltas and the one reader of lines.
 *
 * Plain ESM on purpose. The sync service has no build step, yet it parses the same
 * Markdown and builds the same delta the browser does (ADR-252 §11 stage 7); the
 * `@remo/agent-plan` pattern applies — one runtime module serves every caller, and the
 * TypeScript types stay in `index.d.ts`.
 *
 * Nothing here touches Yjs or React: a delta is plain data in, plain data out, so the
 * rules can be tested without a document or a browser.
 */
import { safeExternalUrl } from "./url.mjs";

/* ------------------------------------------------------------- canonical --- */

/**
 * Canonical inline marks.
 *
 * Only the six marks this product has are kept, and an unset mark is absent rather than
 * `false`, so two deltas that mean the same thing compare equal.
 */
export function canonicalMarks(marks) {
  const out = {};
  if (marks?.bold) out.bold = true;
  if (marks?.italic) out.italic = true;
  if (marks?.underline) out.underline = true;
  if (marks?.strike) out.strike = true;
  if (marks?.code) out.code = true;
  if (typeof marks?.href === "string") {
    const href = safeExternalUrl(marks.href);
    if (href) out.href = href;
  }
  return out;
}

/** Lists take an indent; headings and ordinary lines do not. */
function isList(block) {
  return block === "bullet" || block === "ordered" || block === "check";
}

/** Canonical line format, the only attributes a `\n` may carry. */
export function canonicalLineFormat(format) {
  const out = {};
  const block = format?.block;
  if (block === "h1" || block === "h2" || block === "bullet" || block === "ordered" || block === "check") {
    out.block = block;
  }
  if (isList(out.block) && (format?.indent === 1 || format?.indent === 2)) {
    out.indent = format.indent;
  }
  if (out.block === "check" && format?.checked === true) out.checked = true;
  return out;
}

/**
 * Canonical attributes of one delta operation (ADR-252 §2.3).
 *
 * A line format belongs only on the `\n` that ends a line; inline marks belong only on
 * ordinary characters. An invalid link is dropped rather than thrown at, so a document
 * written by a hostile or older client still opens.
 */
export function canonicalAttributes(op) {
  return op.insert === "\n" ? canonicalLineFormat(op.attributes) : canonicalMarks(op.attributes);
}

/**
 * Identity of a canonical attribute set, for grouping adjacent characters.
 *
 * Callers pass attributes that already went through `canonicalMarks` or
 * `canonicalLineFormat`; doing it again here would parse every link twice per character.
 */
export function marksKey(attributes) {
  if (!attributes) return "";
  if (
    !attributes.bold &&
    !attributes.italic &&
    !attributes.underline &&
    !attributes.strike &&
    !attributes.code &&
    !attributes.href &&
    !attributes.block &&
    !attributes.indent &&
    !attributes.checked
  ) {
    return "";
  }
  // A NUL separator is safe: `safeExternalUrl` rejects control characters, and the
  // rest are fixed enums and booleans. Building the key without JSON keeps a keystroke
  // in a long note cheap.
  return [
    attributes.bold ? "b" : "",
    attributes.italic ? "i" : "",
    attributes.underline ? "u" : "",
    attributes.strike ? "s" : "",
    attributes.code ? "c" : "",
    attributes.href ?? "",
    attributes.block ?? "",
    attributes.indent ?? 0,
    attributes.checked ? "x" : "",
  ].join("\u0000");
}

/** Attributes for an insertion; every attribute is explicit, so nothing is inherited. */
export function insertionAttributes(attributes) {
  const marks = canonicalMarks(attributes);
  const line = canonicalLineFormat(attributes);
  return {
    bold: marks.bold ? true : null,
    italic: marks.italic ? true : null,
    underline: marks.underline ? true : null,
    strike: marks.strike ? true : null,
    code: marks.code ? true : null,
    href: marks.href ?? null,
    block: line.block ?? null,
    indent: line.indent ?? null,
    checked: line.checked ? true : null,
  };
}

/** Merge adjacent operations with the same attributes and drop empty ones. */
export function normalizeDelta(delta) {
  const out = [];
  const push = (insert, attributes) => {
    if (!insert) return;
    const key = marksKey(attributes);
    const last = out[out.length - 1];
    if (last && marksKey(last.attributes) === key) {
      last.insert += insert;
      return;
    }
    out.push(Object.keys(attributes).length ? { insert, attributes } : { insert });
  };

  for (const op of delta) {
    if (!op.insert) continue;
    const marks = canonicalMarks(op.attributes);
    const line = canonicalLineFormat(op.attributes);
    let start = 0;
    for (let index = 0; index < op.insert.length; index += 1) {
      if (op.insert[index] !== "\n") continue;
      // A newline is its own operation: a line format may sit on it while the rest of
      // the run stays inline, and an old client's mixed op must not move one to the other.
      push(op.insert.slice(start, index), marks);
      push("\n", line);
      start = index + 1;
    }
    push(op.insert.slice(start), marks);
  }
  return out;
}

/** Plain text of a delta, without marks. */
export function plainTextOf(delta) {
  return delta.map((op) => op.insert).join("");
}

/**
 * Plain text as a reader shows it.
 *
 * A block-formatted last line stores a terminating newline (ADR-252 §2.2); it is a line
 * terminator, not a second empty line, so display text drops it. Every other trailing
 * newline is an empty line and stays, exactly as plain text has always read.
 */
export function displayTextOf(delta) {
  const text = plainTextOf(delta);
  const last = delta[delta.length - 1];
  return last?.insert.endsWith("\n") && last.attributes?.block ? text.slice(0, -1) : text;
}

/* ----------------------------------------------------------------- lines --- */

/** Append a character to a run list, merging it with an identical neighbour. */
function pushRun(runs, ch, marks) {
  const last = runs[runs.length - 1];
  if (last && marksKey(last) === marksKey(marks)) {
    last.text += ch;
    return;
  }
  runs.push({ text: ch, ...marks });
}

/** §2.4: computed numbering, never stored. */
function numberOrdered(lines) {
  const counters = [0, 0, 0];
  for (const line of lines) {
    if (line.block === "ordered") {
      // A new item starts a fresh nested group below it.
      for (let level = line.indent + 1; level < counters.length; level += 1) counters[level] = 0;
      const next = (counters[line.indent] ?? 0) + 1;
      counters[line.indent] = next;
      line.ordinal = next;
      continue;
    }
    // Any line of the same or a smaller level breaks the group; a deeper line belongs
    // to the parent's item and does not interrupt its numbering.
    for (let level = line.indent; level < counters.length; level += 1) counters[level] = 0;
  }
}

/**
 * The one reader of lines (ADR-252 §2.2).
 *
 * The format of a line lives on the `\n` that ends it: inline marks on a newline and
 * line formats on an ordinary character are both dropped, so a delta written by any
 * client reads the same way. The terminating `\n` of a formatted last line is not an
 * empty line; every other trailing newline is, exactly as plain text has always read.
 */
export function linesOf(delta) {
  const lines = [];
  let runs = [];

  for (const op of delta) {
    const marks = canonicalMarks(op.attributes);
    const format = canonicalLineFormat(op.attributes);
    for (const ch of op.insert) {
      if (ch === "\n") {
        lines.push({
          runs,
          ...(format.block ? { block: format.block } : {}),
          indent: format.indent ?? 0,
          checked: format.checked === true,
        });
        runs = [];
        continue;
      }
      pushRun(runs, ch, marks);
    }
  }

  const last = lines[lines.length - 1];
  if (!lines.length || runs.length || !last?.block) {
    lines.push({ runs, indent: 0, checked: false });
  }

  numberOrdered(lines);
  return lines;
}

/** Does this run carry any inline mark? */
export function hasMarks(run) {
  return Boolean(run.bold || run.italic || run.underline || run.strike || run.code || run.href);
}

/**
 * Does this delta carry any attribute at all — an inline mark or a line format?
 *
 * A delta without attributes takes the plain path, which keeps today's `Y.Text`
 * storage, painter and layout byte for byte (ADR-252, rule 2).
 */
export function isRichDelta(delta) {
  return delta.some((op) => Boolean(op.attributes) && Object.keys(op.attributes).length > 0);
}

/**
 * A delta in the shape `Y.XmlText.applyDelta` expects.
 *
 * Marks are explicit on every run, so a plain run is never painted with the formatting
 * to its left. One mapping for the browser, the agent plan and the command layer: the
 * three write the same operations into the shared text.
 */
export function insertionOps(delta) {
  return normalizeDelta(delta).map((op) => ({
    insert: op.insert,
    attributes: insertionAttributes(op.attributes ?? {}),
  }));
}
