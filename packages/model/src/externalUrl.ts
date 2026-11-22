/**
 * The one rule for an external link (ADR-103, ADR-171).
 *
 * The implementation lives in `@remo/text`, beside the delta canonicalisation and the
 * Markdown reader that also need it; this module keeps the model's public name for it.
 * A link that only the writer checks is not checked at all — any editor can put a raw
 * value into the shared document without the command.
 */
export { safeExternalUrl } from "@remo/text";
