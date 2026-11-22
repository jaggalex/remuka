import { BRAND, brandName } from "@remo/brand";

/**
 * One place for the public identity of the build (ADR-179, ADR-254).
 *
 * The name and the homepage come from `@remo/brand`: «Ремука» is a proper noun and is
 * not an i18n key. An installation's own name arrives from the service as `productName`
 * and wins over the brand; `author`, `license` and `year` stay here.
 */
export const ABOUT = {
  name: BRAND.name,
  legacy: BRAND.legacy,
  version: __REMO_VERSION__,
  build: __REMO_BUILD__,
  commit: __REMO_COMMIT__,
  author: "Alexander Kostylev",
  license: "AGPL-3.0-only",
  year: 2026,
  source: BRAND.repo.url,
  homepage: `https://${BRAND.domains.site}`,
} as const;

/** What the menus show: «Ремука 0.8.0 · 1247» in Russian, the English name in English. */
export function aboutLabel(locale: "ru" | "en", productName: string | null = null): string {
  const name = brandName({ locale, productName });
  return ABOUT.build === "dev" ? `${name} ${ABOUT.version}` : `${name} ${ABOUT.version} · ${ABOUT.build}`;
}
