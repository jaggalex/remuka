/**
 * The installation's own public name (ADR-254, `spec/rebrand.md` §3).
 *
 * `REMO_PRODUCT_NAME` is the variable an operator sets to run a fork under its own name.
 * `REMO_MAIL_PRODUCT_NAME` stays as a deprecated synonym, so an existing environment
 * needs no edit. Only the override is read here: the brand default belongs to
 * `@remo/brand`, never to this file.
 */
import { BRAND } from "@remo/brand";

export function productNameOverride(env = process.env) {
  const chosen = String(env.REMO_PRODUCT_NAME ?? "").trim();
  if (chosen) return chosen;
  const legacy = String(env.REMO_MAIL_PRODUCT_NAME ?? "").trim();
  return legacy || null;
}

/** What a person sees: the installation's own name, else the brand's English spelling. */
export function productName(env = process.env) {
  return productNameOverride(env) ?? BRAND.name.en;
}

/** The mail variable still works, but it no longer names only mail (§3). */
export function warnDeprecatedProductName(env = process.env, log = console.warn) {
  if (env.REMO_MAIL_PRODUCT_NAME && !env.REMO_PRODUCT_NAME) {
    log("[brand] REMO_MAIL_PRODUCT_NAME is deprecated; set REMO_PRODUCT_NAME instead");
  }
}
