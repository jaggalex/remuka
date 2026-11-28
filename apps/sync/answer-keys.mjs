/**
 * Keys of the two-sided sticky-note state (ADR-320).
 *
 * The sync service runs the source `.ts` packages only through the Vite/Vitest
 * transpiler; plain Node imports of `@remo/model` fail on TS sources. These two keys
 * are a storage contract, so the server keeps its own plain-ESM copy of them.
 */
export const ANSWERS_PREFIX = "answers:";
export const BACK_TEXT_SUFFIX = "#back";

export function answersKey(frameId) {
  return `${ANSWERS_PREFIX}${frameId}`;
}

export function backTextKey(widgetId) {
  return `${widgetId}${BACK_TEXT_SUFFIX}`;
}
