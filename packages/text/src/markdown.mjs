/**
 * The Markdown subset that maps onto the note model (ADR-252 §4).
 *
 * One parser and one serialiser, no dependency: paste, copy, the command API, the
 * projection, MCP and the agents all speak this dialect, so a round trip is the
 * contract — `parseMarkdown(toMarkdown(d))` is the same delta as `d` for any delta the
 * model can hold.
 *
 * Blocks are headings, both list kinds, checklists and their two levels of indent.
 * Inline marks are bold, italic, strike, code and a link. Underline has no Markdown
 * syntax, so it is written as `<u>…</u>` — the one addition to the table in §4, without
 * which the round trip could not hold for all four marks.
 */
import { linesOf, normalizeDelta } from "./lines.mjs";
import { safeExternalUrl } from "./url.mjs";

/** Characters a backslash may escape. Escaping anything else leaves the backslash. */
const ESCAPABLE = new Set("\\`*_{}[]()#+-.!~>|<".split(""));

function isWordChar(char) {
  return char != null && /[\p{L}\p{N}]/u.test(char);
}

function marked(marks) {
  return Boolean(marks.bold || marks.italic || marks.underline || marks.strike || marks.code || marks.href);
}

function pushOp(out, text, marks) {
  if (!text) return;
  out.push(marked(marks) ? { insert: text, attributes: { ...marks } } : { insert: text });
}

/* ------------------------------------------------------------------ inline --- */

/**
 * Find the closing delimiter for an emphasis run starting at `start`.
 *
 * CommonMark's short rules are enough here: no space just inside the delimiters, `_` does
 * not open inside a word (`snake_case`), a single `*`/`_` never takes one character of a
 * longer run (`**x**` stays bold), and an escaped marker never closes anything.
 */
function findEmphasis(line, start, marker) {
  const innerStart = start + marker.length;
  if (innerStart >= line.length) return null;
  if (line[innerStart] === " ") return null;
  const underscore = marker[0] === "_";
  if (underscore && isWordChar(line[start - 1])) return null;

  let search = innerStart;
  for (;;) {
    const close = findOutsideCode(line, marker, search);
    if (close < 0) return null;
    search = close + marker.length;
    if (close === innerStart) continue;
    if (line[close - 1] === " ") continue;
    if (marker.length === 1) {
      const same = marker;
      // A single marker never takes one character of a longer run: `**x**` is bold,
      // and the `*` of a nested pair is not the outer run's closing one. An escaped
      // marker next to it (`\**`) belongs to the text, not to a longer run.
      const previous = line[close - 1] === same && line[close - 2] !== "\\";
      if (previous || line[close + 1] === same) continue;
      if (underscore && isWordChar(line[close + 1])) continue;
    }
    return { inner: line.slice(innerStart, close), end: close + marker.length };
  }
}

/** Longer markers first, so `**x**` is never read as two italics. */
const EMPHASIS = [
  ["**", "bold"],
  ["__", "bold"],
  ["~~", "strike"],
  ["*", "italic"],
  ["_", "italic"],
];

/** The emphasis run that opens here, if any. */
function emphasisAt(line, start) {
  // `***x***` is bold and italic at once. A full delimiter stack is not worth it here;
  // the three-character form is what people actually paste.
  for (const char of ["*", "_"]) {
    const triple = char.repeat(3);
    if (!line.startsWith(triple, start)) continue;
    const close = findOutsideCode(line, triple, start + 3);
    if (close < 0 || line[start + 3] === " " || line[close - 1] === " ") continue;
    return {
      inner: line.slice(start + 3, close),
      end: close + 3,
      marks: { bold: true, italic: true },
    };
  }

  for (const [marker, mark] of EMPHASIS) {
    if (!line.startsWith(marker, start)) continue;
    const match = findEmphasis(line, start, marker);
    if (match) return { ...match, marks: { [mark]: true } };
  }
  return null;
}

/** The backtick run that opens here, and its length. */
function backtickRun(line, start) {
  let end = start;
  while (line[end] === "`") end += 1;
  return end - start;
}

/** A code span opened by a run of `count` backticks, with its closing run. */
function codeSpanAt(line, start) {
  const count = backtickRun(line, start);
  const delimiter = "`".repeat(count);
  let search = start + count;
  for (;;) {
    const close = line.indexOf(delimiter, search);
    if (close < 0) return null;
    // Only a run of exactly the same length closes; a longer run is somebody's content.
    if (line[close - 1] === "`" || line[close + count] === "`") {
      search = close + count;
      continue;
    }
    let inner = line.slice(start + count, close);
    // CommonMark's padding rule: when a span starts and ends with a space to keep a
    // backtick away from the delimiter, one space on each side is not content.
    if (inner.length >= 2 && inner.startsWith(" ") && inner.endsWith(" ") && inner.trim()) {
      inner = inner.slice(1, -1);
    }
    return { inner, end: close + count };
  }
}

/** The next `needle` that is neither escaped nor inside a code span or an inline tag. */
function findOutsideCode(line, needle, from) {
  let index = from;
  while (index < line.length) {
    if (line[index] === "\\") {
      index += 2;
      continue;
    }
    if (line[index] === "<") {
      const tag = INLINE_TAG.exec(line.slice(index));
      if (tag) {
        const name = tag[1].toLowerCase();
        const closeTag = `</${name}>`;
        const close =
          name === "code"
            ? line.toLowerCase().indexOf(closeTag, index + tag[0].length)
            : findOutsideCode(line.toLowerCase(), closeTag, index + tag[0].length);
        if (close > index) {
          index = close + closeTag.length;
          continue;
        }
      }
    }
    if (line[index] === "`") {
      const span = codeSpanAt(line, index);
      if (span) {
        index = span.end;
        continue;
      }
    }
    if (line.startsWith(needle, index)) return index;
    index += 1;
  }
  return -1;
}

/** A `[label](target)` link that opens here, if any. */
function linkAt(line, start) {
  if (line[start] !== "[") return null;
  const closeBracket = findOutsideCode(line, "]", start + 1);
  if (closeBracket <= start + 1 || line[closeBracket + 1] !== "(") return null;

  let depth = 0;
  let closeParen = -1;
  for (let index = closeBracket + 1; index < line.length; index += 1) {
    const char = line[index];
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        closeParen = index;
        break;
      }
    }
  }
  if (closeParen < 0) return null;
  const target = unescape(line.slice(closeBracket + 2, closeParen));
  if (!target.trim()) return null;
  return { label: line.slice(start + 1, closeBracket), target, end: closeParen + 1 };
}

function unescape(text) {
  let out = "";
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\\" && ESCAPABLE.has(text[index + 1] ?? "")) {
      out += text[index + 1];
      index += 1;
      continue;
    }
    out += char;
  }
  return out;
}

/** The inline tags Markdown itself has no syntax for, or cannot delimit cleanly. */
const INLINE_TAG = /^<(b|strong|i|em|s|del|u|ins|code)>/i;

function tagMarks(name) {
  switch (name) {
    case "b":
    case "strong":
      return { bold: true };
    case "i":
    case "em":
      return { italic: true };
    case "s":
    case "del":
      return { strike: true };
    case "u":
    case "ins":
      return { underline: true };
    default:
      return { code: true };
  }
}

/** Inline rules for one line: escapes, code, emphasis, links and inline tags. */
function parseInline(line, marks, out) {
  let literal = "";
  const flush = () => {
    pushOp(out, literal, marks);
    literal = "";
  };

  let i = 0;
  while (i < line.length) {
    const char = line[i];

    if (char === "\\" && ESCAPABLE.has(line[i + 1] ?? "")) {
      literal += line[i + 1];
      i += 2;
      continue;
    }

    if (char === "`") {
      const span = codeSpanAt(line, i);
      if (span) {
        flush();
        pushOp(out, span.inner, { ...marks, code: true });
        i = span.end;
        continue;
      }
      literal += char;
      i += 1;
      continue;
    }

    if (char === "<") {
      const tag = INLINE_TAG.exec(line.slice(i));
      if (tag) {
        const name = tag[1].toLowerCase();
        const closeTag = `</${name}>`;
        const close =
          name === "code"
            ? line.toLowerCase().indexOf(closeTag, i + tag[0].length)
            : findOutsideCode(line.toLowerCase(), closeTag, i + tag[0].length);
        if (close > i) {
          flush();
          const inner = line.slice(i + tag[0].length, close);
          if (name === "code") pushOp(out, inner, { ...marks, code: true });
          else parseInline(inner, { ...marks, ...tagMarks(name) }, out);
          i = close + closeTag.length;
          continue;
        }
      }
      literal += char;
      i += 1;
      continue;
    }

    const emphasis = emphasisAt(line, i);
    if (emphasis) {
      flush();
      parseInline(emphasis.inner, { ...marks, ...emphasis.marks }, out);
      i = emphasis.end;
      continue;
    }

    const link = linkAt(line, i);
    if (link) {
      flush();
      // A target outside http(s)/mailto is not a link: the label stays, the address goes,
      // exactly as the HTML reader treats a `javascript:` anchor.
      const href = safeExternalUrl(link.target);
      parseInline(link.label, href ? { ...marks, href } : marks, out);
      i = link.end;
      continue;
    }

    literal += char;
    i += 1;
  }
  flush();
}

/* ------------------------------------------------------------------- blocks --- */

const HEADING = /^[ \t]{0,6}(#{1,6})(?:[ \t](.*))?$/;
const CHECK = /^([ \t]*)(?:[-*+][ \t])?\[([ xX])\](?:[ \t](.*))?$/;
const BULLET = /^([ \t]*)[-*+][ \t](.*)$/;
const ORDERED = /^([ \t]*)\d{1,9}[.)][ \t](.*)$/;
const QUOTE = /^[ \t]*>(?:[ \t](.*))?$/;
const FENCE = /^[ \t]*(`{3,}|~{3,})(.*)$/;

/** Leading whitespace to a list level: two spaces or one tab per level (§4). */
function indentOf(prefix) {
  let columns = 0;
  for (const char of prefix) columns += char === "\t" ? 2 : 1;
  return Math.min(2, Math.floor(columns / 2));
}

/** One source line to its structure; the text stays inline-parsed later. */
function structureOf(line) {
  const heading = HEADING.exec(line);
  if (heading) {
    return {
      text: heading[2] ?? "",
      block: heading[1].length === 1 ? "h1" : "h2",
      indent: 0,
      checked: false,
      code: false,
    };
  }

  const check = CHECK.exec(line);
  if (check) {
    return {
      text: check[3] ?? "",
      block: "check",
      indent: indentOf(check[1]),
      checked: check[2] !== " ",
      code: false,
    };
  }

  const bullet = BULLET.exec(line);
  if (bullet) {
    return {
      text: bullet[2] ?? "",
      block: "bullet",
      indent: indentOf(bullet[1]),
      checked: false,
      code: false,
    };
  }

  const ordered = ORDERED.exec(line);
  if (ordered) {
    return {
      text: ordered[2] ?? "",
      block: "ordered",
      indent: indentOf(ordered[1]),
      checked: false,
      code: false,
    };
  }

  const quote = QUOTE.exec(line);
  if (quote) return { text: quote[1] ?? "", indent: 0, checked: false, code: false };

  return { text: line, indent: 0, checked: false, code: false };
}

function lineFormatOf(line) {
  const format = {};
  if (line.block) format.block = line.block;
  if (
    (line.block === "bullet" || line.block === "ordered" || line.block === "check") &&
    line.indent
  ) {
    format.indent = line.indent;
  }
  if (line.block === "check" && line.checked) format.checked = true;
  return format;
}

/**
 * Markdown text to a delta.
 *
 * The fence delimiters are structure, not text: they are dropped and their content
 * lines carry the code mark with every space kept. Every other line keeps its characters
 * one for one.
 */
export function parseMarkdown(source) {
  const sourceLines = source.replace(/\r\n?/g, "\n").split("\n");
  const parsed = [];
  let fence = null;

  for (const line of sourceLines) {
    const open = FENCE.exec(line);
    if (fence) {
      const closing = open && line.trim().startsWith(fence) && line.trim().replace(/[`~]/g, "") === "";
      if (closing) {
        fence = null;
        continue;
      }
      parsed.push({ text: line, indent: 0, checked: false, code: true });
      continue;
    }
    if (open) {
      fence = open[1];
      continue;
    }
    parsed.push(structureOf(line));
  }

  const out = [];
  parsed.forEach((line, index) => {
    if (line.code) pushOp(out, line.text, { code: true });
    else parseInline(line.text, {}, out);

    const format = lineFormatOf(line);
    const last = index === parsed.length - 1;
    // A formatted last line carries its terminating `\n`, like the editor's own delta.
    if (!last || format.block) {
      out.push(
        Object.keys(format).length ? { insert: "\n", attributes: format } : { insert: "\n" },
      );
    }
  });
  return normalizeDelta(out);
}

/* -------------------------------------------------------------- delta → text --- */

/** Escape the characters of one run so the parser reads them back unchanged. */
function escapeText(text) {
  let out = "";
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\\" || char === "`" || char === "*" || char === "~" || char === "[" ||
      char === "]" || char === "<") {
      out += `\\${char}`;
      continue;
    }
    // `_` only starts emphasis at a word edge, so `snake_case` stays readable.
    if (char === "_" && (!isWordChar(text[index - 1]) || !isWordChar(text[index + 1]))) {
      out += "\\_";
      continue;
    }
    out += char;
  }
  return out;
}

/** A code run's delimiter: one backtick more than any run inside it. */
function codeDelimiter(text) {
  let longest = 0;
  let run = 0;
  for (const char of text) {
    if (char === "`") {
      run += 1;
      longest = Math.max(longest, run);
    } else {
      run = 0;
    }
  }
  return "`".repeat(longest + 1);
}

const GROUPED = [
  ["bold", "**", "b"],
  ["italic", "*", "i"],
  ["strike", "~~", "s"],
];

/**
 * Wrap already-serialised content in one mark.
 *
 * `**`/`*`/`~~` need a non-space just inside both delimiters. Content with a space at an
 * edge goes into the inline tag instead — valid Markdown, and the only form that keeps a
 * space inside the mark.
 */
function wrapInline(tag, inner, grouped = false) {
  const [, delimiter, html] = GROUPED.find(([mark]) => mark === tag);
  // A grouping wrapper is the one place where two runs' delimiters would meet
  // (`*a*` + `**b**` is `*a***b**`, and every reader puts the boundary elsewhere), so
  // a group is written with the inline tag. Single runs keep the readable markers.
  if (/^[ \t]|[ \t]$/.test(inner) || grouped) return `<${html}>${inner}</${html}>`;
  return `${delimiter}${inner}${delimiter}`;
}

/**
 * A code run between backticks.
 *
 * A backtick at either edge would merge with the delimiter and turn the opening run into
 * a longer one, so such content gets CommonMark's one-space padding instead.
 */
function codeRun(text) {
  const delimiter = codeDelimiter(text);
  const pad = text.startsWith("`") || text.endsWith("`");
  return pad ? `${delimiter} ${text} ${delimiter}` : `${delimiter}${text}${delimiter}`;
}

/** One run, with code and every mark it carries. */
function oneRun(run, adjacentCode, tagStars = false) {
  const edgeSpace = /^[ \t]|[ \t]$/.test(run.text);
  const code = run.code
    ? adjacentCode || edgeSpace
      ? `<code>${run.text}</code>`
      : codeRun(run.text)
    : escapeText(run.text);
  let text = code;
  // Inner to outer, so the delimiters nest the way the parser accumulates marks.
  if (run.strike) text = wrapInline("strike", text);
  if (run.italic) {
    text = tagStars ? `<i>${text}</i>` : wrapInline("italic", text);
  }
  if (run.bold) {
    text = tagStars ? `<b>${text}</b>` : wrapInline("bold", text);
  }
  if (run.underline) text = `<u>${text}</u>`;
  if (run.href) text = `[${text}](${escapeTarget(run.href)})`;
  return text;
}

/**
 * Runs to Markdown, grouping neighbours that share a mark.
 *
 * Two adjacent runs both italic would produce `*a**b*`, which every reader (ours
 * included) takes for bold at the junction. When every run at the front of the slice has
 * the same mark, that mark wraps the whole group once — the same characters carry it
 * and no two delimiters of the same kind touch.
 */
function runsMarkdown(runs) {
  if (!runs.length) return "";
  if (runs.length === 1) return oneRun(runs[0], false);

  for (const [mark] of GROUPED) {
    if (!runs[0][mark]) continue;
    let end = 1;
    while (end < runs.length && runs[end][mark]) end += 1;
    if (end < 2) continue;
    const inner = runsMarkdown(
      runs.slice(0, end).map((run) => ({ ...run, [mark]: undefined })),
    );
    return wrapInline(mark, inner, true) + runsMarkdown(runs.slice(end));
  }

  // Nothing is shared with the next run. A `*` on both sides of the boundary would
  // still merge (`*a***b**`), so the left run switches to tags for its star marks.
  const next = runs[1];
  const codeNeighbour = Boolean(next.code);
  const starBoundary = Boolean((runs[0].bold || runs[0].italic) && (next.bold || next.italic));
  return oneRun(runs[0], codeNeighbour, starBoundary) + runsMarkdown(runs.slice(1));
}

/** A link target, with the parentheses the parser counts escaped. */
function escapeTarget(href) {
  return href.replace(/([()\\])/g, "\\$1");
}

/** Escape a line that would otherwise read as a block marker. */
function escapeBlockStart(body) {
  const marker = /^([ \t]*)([-+>#]+)(?=[ \t]|$)/.exec(body);
  if (marker) return `${marker[1]}\\${body.slice(marker[1].length)}`;
  const numbered = /^([ \t]*\d{1,9})([.)])(?=[ \t])/.exec(body);
  if (numbered) {
    const at = numbered[1].length;
    return `${body.slice(0, at)}\\${body.slice(at)}`;
  }
  return body;
}

function lineMarkdown(line) {
  const body = runsMarkdown(line.runs);
  switch (line.block) {
    case "h1":
      return `# ${body}`;
    case "h2":
      return `## ${body}`;
    case "bullet":
      return `${"  ".repeat(line.indent)}- ${body}`;
    case "ordered":
      return `${"  ".repeat(line.indent)}${line.ordinal ?? 1}. ${body}`;
    case "check":
      return `${"  ".repeat(line.indent)}- [${line.checked ? "x" : " "}] ${body}`;
    default:
      return escapeBlockStart(body);
  }
}

/** A line whose every visible character is code is written as a fenced block. */
function isCodeLine(line) {
  const text = line.runs.map((run) => run.text).join("");
  return (
    !line.block &&
    text.length > 0 &&
    line.runs.every((run) => run.code && !run.bold && !run.italic && !run.underline &&
      !run.strike && !run.href)
  );
}

/**
 * Delta to Markdown — the `text/plain` half of copying (ADR-252 §4, §5.5).
 *
 * Lines come from `linesOf`, so the writer never invents a structure the document does
 * not have. Consecutive all-code lines become one fence; everything else is a line.
 */
export function toMarkdown(delta) {
  const lines = linesOf(delta);
  const out = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!isCodeLine(line)) {
      out.push(lineMarkdown(line));
      index += 1;
      continue;
    }
    let end = index;
    while (end < lines.length && isCodeLine(lines[end])) end += 1;
    const body = lines.slice(index, end).map((entry) => entry.runs.map((run) => run.text).join(""));
    // A fence longer than any backtick run inside it, so no line can close it early.
    let longest = 0;
    for (const text of body) {
      let run = 0;
      for (const char of text) {
        if (char !== "`") {
          run = 0;
          continue;
        }
        run += 1;
        longest = Math.max(longest, run);
      }
    }
    const fence = "`".repeat(Math.max(3, longest + 1));
    out.push(fence, ...body, fence);
    index = end;
  }
  return out.join("\n");
}

/**
 * Does this plain-text clipboard look like Markdown? (§4)
 *
 * The test is deliberately conservative: a wrong "yes" would eat literal asterisks, while
 * a wrong "no" only pastes plain text. ⌘⇧V never asks.
 */
export function isMarkdown(text) {
  if (!text.trim()) return false;

  const lineMarker = /^[ \t]{0,6}(?:[-*+][ \t]+(?:\[[ xX]\][ \t]+)?|#{1,6}[ \t]+|\d{1,9}[.)][ \t]+|\[[ xX]\][ \t]+)/m;
  if (lineMarker.test(text)) return true;

  if (/\*\*[^\n]+\*\*/.test(text)) return true;
  if (/__[^\n]+__/.test(text)) return true;
  if (/~~[^\n]+~~/.test(text)) return true;
  if (/^[ \t]*(?:`{3,}|~{3,})/m.test(text)) return true;
  if (/`[^`\n]+`/.test(text)) return true;

  return /\[[^\]\n]+\]\(https?:\/\/[^\s)]+\)/.test(text);
}
