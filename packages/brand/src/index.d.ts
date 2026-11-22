/**
 * Types for `@remo/brand` (ADR-254).
 *
 * The runtime is `src/index.mjs`: sync has no build step, so one plain module serves the
 * browser, the service and the documentation build. These declarations are the contract
 * those callers are checked against.
 */

/** Interface languages the brand has a name for. */
export type BrandLocale = "ru" | "en";

/** A per-language string: the same fact in Russian and in English. */
export interface BrandName {
  ru: string;
  en: string;
}

/** The cloud's hosts. A self-host installation keeps its own addresses in env. */
export interface BrandDomains {
  /** Cloud application: web, sync, API, MCP and WebSocket. */
  app: string;
  /** Application of the separate installation in Russia (ADR-254 §5.1). */
  appRu: string;
  /** Public API origin, when it differs from the application host. */
  api: string;
  /** Product guide, RU and EN. */
  docs: string;
  /** Guide of the Russian installation; canonical pages stay on `docs`. */
  docsRu: string;
  /** English landing page, canonical for EN. */
  site: string;
  /** Russian landing page, canonical for RU. */
  siteRu: string;
  /** Support chat (ADR-250). */
  support: string;
  /** Service status page. */
  status: string;
  /** Mail sending domain for Resend. */
  mail: string;
}

/** The public source repository: one URL for the About page, the guide and scripts. */
export interface BrandRepo {
  /** Clone and browse address, always `https://github.com/…`. */
  readonly url: string;
  /** `owner/repository`, the form an issue link is built from. */
  readonly name: string;
}

/** Russian grammatical cases a sentence may need. */
export type BrandRuCase =
  | "nominative"
  | "genitive"
  | "dative"
  | "accusative"
  | "instrumental"
  | "prepositional";

/** Russian case forms of the public name. */
export type BrandCases = Readonly<Record<BrandRuCase, string>>;

export interface Brand {
  /** The code name: packages, env, headers, metrics and storage keys. */
  readonly code: "remo";
  /** The public name with a capital letter. */
  readonly name: Readonly<BrandName>;
  /** Russian case forms of the public name (`spec/rebrand.md` §4.3). */
  readonly cases: Readonly<{ ru: BrandCases }>;
  /** The old name, only for «раньше remo» on the About page. */
  readonly legacy: Readonly<BrandName>;
  readonly pronunciation: Readonly<BrandName>;
  readonly domains: Readonly<BrandDomains>;
  readonly repo: BrandRepo;
}

export declare const BRAND: Brand;

export interface BrandNameOptions {
  /** Defaults to `ru`; `ru` gives «Ремука», every other value «Remuka». */
  locale?: BrandLocale;
  /** An installation's own name; a non-blank value wins over the brand. */
  productName?: string | null;
}

/** The name a person sees: the installation's own name, else «Ремука» / «Remuka». */
export declare function brandName(options?: BrandNameOptions): string;

/** The old name for the one allowed history line: «Ремука (раньше remo)». */
export declare function brandLegacyName(locale?: BrandLocale): string;

/** The Russian cases a sentence may need. */
export declare const BRAND_RU_CASES: readonly BrandRuCase[];

export interface BrandNameCaseOptions extends BrandNameOptions {
  /** Defaults to `nominative`. Ignored for a non-Russian locale and for an own name. */
  grammaticalCase?: BrandRuCase;
}

/**
 * The name in a Russian case. An installation's own name is returned unchanged; the
 * caller uses «в сервисе {product}» for that case (`spec/rebrand.md` §4.3).
 */
export declare function brandNameCase(options?: BrandNameCaseOptions): string;
