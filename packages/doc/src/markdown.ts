/**
 * The Markdown boundary of the document (ADR-252 §4).
 *
 * The dialect lives in `@remo/text` because the sync service and the agent contract
 * write the same Markdown without a build step (ADR-252 §11 stage 7). This module keeps
 * the name `@remo/doc` has always exported, so paste, copy, the editor and the Read API
 * keep one import.
 */
export { cleanMarkdown, isMarkdown, parseMarkdown, toMarkdown } from "@remo/text";
