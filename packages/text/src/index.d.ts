/**
 * Types for `@remo/text` (ADR-252).
 *
 * The runtime is `index.mjs`: sync has no build step, so one plain module serves the
 * browser, the server and the agent contract. These declarations are the contract those
 * callers are checked against.
 */

/** Inline marks a note can carry. Formatting is per character, not per note. */
export interface TextMarks {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  /** Inline code (ADR-252). An unset mark is absent, never `false`. */
  code?: boolean;
  /** Link target; only `http:`, `https:` and `mailto:` (ADR-252). */
  href?: string;
}

/** The line format a block can carry. It lives on the `\n` that ends the line. */
export interface LineFormat {
  block?: "h1" | "h2" | "bullet" | "ordered" | "check";
  /** List nesting; absent means 0. Never more than two levels (ADR-252). */
  indent?: 1 | 2;
  /** Only on a `check` line. */
  checked?: boolean;
}

/**
 * One line of text, as every reader of lines sees it (ADR-252 §2.2).
 *
 * `runs` never contain the terminating `\n`; `ordinal` is computed by `linesOf` and is
 * never stored. A document without line formats materializes no `lines` at all, so an
 * old note keeps the plain painter and exactly its old layout.
 */
export interface TextLine {
  runs: TextRun[];
  block?: LineFormat["block"];
  indent: 0 | 1 | 2;
  checked: boolean;
  /** 1-based number for an `ordered` line, computed in `linesOf`. */
  ordinal?: number;
}

/** A piece of text with one set of marks — what the painter draws. */
export interface TextRun extends TextMarks {
  text: string;
}

/** One operation of a rich-text delta, as Y.XmlText stores it. */
export interface TextDeltaOp {
  insert: string;
  attributes?: TextMarks & LineFormat;
}

/** What a command may ask a line to become; `null` clears the format. */
export interface LineFormatInput {
  block?: LineFormat["block"] | null;
  indent?: 0 | 1 | 2 | null;
  checked?: boolean | null;
}

/** A safe external URL, or null. Only http, https and mailto; no credentials. */
export declare function safeExternalUrl(value: string): string | null;

/** Canonical inline marks: only the six the product has, and never `false`. */
export declare function canonicalMarks(marks?: TextMarks): TextMarks;

/** Canonical line format: the only attributes a `\n` may carry. */
export declare function canonicalLineFormat(
  format?: LineFormatInput | LineFormat,
): LineFormat;

/** Canonical attributes of one delta operation. */
export declare function canonicalAttributes(op: TextDeltaOp): TextMarks & LineFormat;

/** Identity of a canonical attribute set, for grouping adjacent characters. */
export declare function marksKey(attributes?: TextMarks & LineFormat): string;

/** Attributes for an insertion; every attribute is explicit. */
export declare function insertionAttributes(
  attributes: TextMarks & LineFormat,
): Record<string, true | string | number | null>;

/** Merge adjacent operations with the same attributes and drop empty ones. */
export declare function normalizeDelta(delta: readonly TextDeltaOp[]): TextDeltaOp[];

/** Plain text of a delta, without marks. */
export declare function plainTextOf(delta: readonly TextDeltaOp[]): string;

/** Plain text as a reader shows it: a formatted last line's terminator is not a line. */
export declare function displayTextOf(delta: readonly TextDeltaOp[]): string;

/** The one reader of lines (ADR-252 §2.2). */
export declare function linesOf(delta: readonly TextDeltaOp[]): TextLine[];

/** Does this run carry any inline mark? */
export declare function hasMarks(run: TextRun): boolean;

/** Does this delta carry any attribute — an inline mark or a line format? */
export declare function isRichDelta(delta: readonly TextDeltaOp[]): boolean;

/** A delta in the shape `Y.XmlText.applyDelta` expects: explicit attributes per run. */
export declare function insertionOps(
  delta: readonly TextDeltaOp[],
): Array<{ insert: string; attributes: Record<string, true | string | number | null> }>;

/** Markdown text to a delta, in the subset that maps onto the model. */
export declare function parseMarkdown(source: string): TextDeltaOp[];

/** Delta to Markdown. */
export declare function toMarkdown(delta: readonly TextDeltaOp[]): string;

/** Does this plain text look like Markdown? */
export declare function isMarkdown(text: string): boolean;

/**
 * Strip HTML from Markdown an untrusted author wrote: foreign tags go, the six inline
 * tags the dialect understands stay for `parseMarkdown` to turn into marks.
 */
export declare function cleanMarkdown(source: string): string;
