/**
 * A tolerant HTML reader for one clipboard fragment (ADR-252 §3).
 *
 * It is deliberately not a browser: no DOM, no resource loading, no script execution and
 * no repair beyond keeping unclosed tags as written. The white list lives one level up in
 * `html.ts`; this file only turns bytes into a tree.
 */

export interface HtmlElement {
  tag: string;
  attributes: Record<string, string>;
  children: HtmlNode[];
}

export type HtmlNode = HtmlElement | string;

const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

const ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: "\u00a0",
  quot: '"',
  laquo: "\u00ab",
  raquo: "\u00bb",
  mdash: "\u2014",
  ndash: "\u2013",
  hellip: "\u2026",
  copy: "\u00a9",
  reg: "\u00ae",
  trade: "\u2122",
  times: "\u00d7",
  middot: "\u00b7",
  bull: "\u2022",
};

function decodeEntities(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(/&(#[xX]?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, body: string) => {
    if (body.startsWith("#")) {
      const hex = body[1] === "x" || body[1] === "X";
      const code = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    }
    return ENTITIES[body.toLowerCase()] ?? match;
  });
}

function parseAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pattern = /([^\s"'=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match: RegExpExecArray | null = pattern.exec(source);
  while (match) {
    const name = match[1]!.toLowerCase();
    attributes[name] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
    match = pattern.exec(source);
  }
  return attributes;
}

/** Tolerant tree of the fragment: unknown and unclosed tags are kept as written. */
export function parseHtml(html: string): HtmlElement {
  const root: HtmlElement = { tag: "#root", attributes: {}, children: [] };
  const stack: HtmlElement[] = [root];
  const append = (node: HtmlNode): void => {
    stack[stack.length - 1]!.children.push(node);
  };

  let i = 0;
  while (i < html.length) {
    const open = html.indexOf("<", i);
    if (open < 0) {
      append(decodeEntities(html.slice(i)));
      break;
    }
    if (open > i) append(decodeEntities(html.slice(i, open)));

    if (html.startsWith("<!--", open)) {
      const end = html.indexOf("-->", open + 4);
      i = end < 0 ? html.length : end + 3;
      continue;
    }
    if (html[open + 1] === "!" || html[open + 1] === "?") {
      const end = html.indexOf(">", open);
      i = end < 0 ? html.length : end + 1;
      continue;
    }

    const close = html.indexOf(">", open);
    if (close < 0) {
      append(decodeEntities(html.slice(open)));
      break;
    }
    const body = html.slice(open + 1, close);

    if (body.startsWith("/")) {
      const name = (body.slice(1).trim().split(/[\s/]/)[0] ?? "").toLowerCase();
      for (let depth = stack.length - 1; depth > 0; depth -= 1) {
        if (stack[depth]!.tag === name) {
          stack.length = depth;
          break;
        }
      }
      i = close + 1;
      continue;
    }

    const name = /^[a-zA-Z][^\s/>]*/.exec(body);
    if (!name) {
      append(decodeEntities(html.slice(open, close + 1)));
      i = close + 1;
      continue;
    }
    const tag = name[0].toLowerCase();
    const element: HtmlElement = {
      tag,
      attributes: parseAttributes(body.slice(name[0].length)),
      children: [],
    };
    append(element);
    if (!body.endsWith("/") && !VOID_TAGS.has(tag)) stack.push(element);
    i = close + 1;
  }

  return root;
}
