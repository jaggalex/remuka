/**
 * The rich-text value model and its Markdown boundary (ADR-252).
 *
 * One runtime module for the browser, the sync service and the agent contract: the
 * rules that read a delta, decide what an attribute may be, and convert between the
 * dialect and the model live here, so no second parser can drift from this one.
 */
export { safeExternalUrl } from "./url.mjs";
export {
  canonicalAttributes,
  canonicalLineFormat,
  canonicalMarks,
  displayTextOf,
  hasMarks,
  insertionAttributes,
  insertionOps,
  linesOf,
  marksKey,
  normalizeDelta,
  plainTextOf,
  isRichDelta,
} from "./lines.mjs";
export { cleanMarkdown } from "./sanitise.mjs";
export { isMarkdown, parseMarkdown, toMarkdown } from "./markdown.mjs";
