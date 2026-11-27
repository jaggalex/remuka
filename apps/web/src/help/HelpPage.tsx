import { useEffect, useMemo, useState } from "react";
import { brandName } from "@remo/brand";
import { BrandMark, Icon } from "@remo/ui";
import { useI18n } from "../i18n";
import { ThemeSwitch } from "../ThemeSwitch";
import { ConsentLink } from "../ConsentProvider";
import { SupportEntryButton } from "../SupportPanel";
import { ABOUT, aboutLabel } from "../about";
import generated from "./generated.json";
import { withDocsOrigin } from "./helpDocs";
import type { HelpLocale, HelpTopicId } from "./topics.generated";
import { HELP_TOPIC_IDS } from "./topics.generated";
import "./help.css";

interface Topic {
  id: HelpTopicId;
  type: "tutorial" | "how-to" | "reference" | "explanation";
  title: Record<HelpLocale, string>;
  summary: Record<HelpLocale, string>;
  related: HelpTopicId[];
  verifiedAgainst: string;
  audience: "public" | "private";
  sourceHash: string;
  translationStatus: "current" | "outdated" | "missing";
  html: Partial<Record<HelpLocale, string>>;
}
interface SearchEntry { id: HelpTopicId; title: string; summary: string; text: string }
const data = generated as unknown as {
  topics: Topic[];
  search: Record<HelpLocale, SearchEntry[]>;
};
const TYPES = ["tutorial", "how-to", "reference", "explanation"] as const;

type TopicType = typeof TYPES[number];

// The two introductory collections also point to published articles classified elsewhere.
// Articles keep their canonical type, stable URL, and complete content.
const collections: Partial<Record<TopicType, HelpTopicId[]>> = {
  tutorial: ["rooms.create", "access.share", "room.tools"],
  explanation: ["sync.status", "access.roles", "agents.room"],
};

function parsePath(fallback: HelpLocale) {
  const match = window.location.pathname.match(/^\/help(?:\/(ru|en)(?:\/([^/]+))?)?\/?$/);
  const lang = (match?.[1] as HelpLocale | undefined) ?? fallback;
  const candidate = match?.[2];
  const topicId = candidate && (HELP_TOPIC_IDS as readonly string[]).includes(candidate)
    ? (candidate as HelpTopicId)
    : null;
  const type = new URLSearchParams(window.location.search).get("type");
  const group = TYPES.find(entry => entry === type) ?? null;
  return { lang, topicId, group };
}

/**
 * Public help centre and article page (ADR-081).
 *
 * It is rendered before the board shell, so it works without a session. Content is
 * generated at build time and bundled: no network request, no service.
 */
export function HelpPage() {
  const { t, lang: appLang, setLang, productName, docsOrigin } = useI18n();
  const [{lang, topicId, group}, setRoute] = useState(() => parsePath(appLang));
  const [query, setQuery] = useState("");

  useEffect(() => {
    document.documentElement.lang = lang;
    setLang(lang);
  }, [lang, setLang]);

  useEffect(() => {
    const onPop = () => setRoute(parsePath(appLang));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [appLang]);

  const topic = topicId ? data.topics.find((candidate) => candidate.id === topicId) : undefined;
  const html = topic?.html[lang] ?? topic?.html.ru;
  // The guide's host arrives from `/config`, never from the build (ADR-284); without a
  // guide the link stays as its own words.
  const body = useMemo(() => (html ? withDocsOrigin(html, docsOrigin) : null), [html, docsOrigin]);
  const status = topic?.translationStatus ?? "current";

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return null;
    return data.search[lang].filter((entry) =>
      [entry.title, entry.summary, entry.text].some((value) => value.toLowerCase().includes(needle)),
    );
  }, [lang, query]);

  const groupQuery = group ? `?type=${group}` : "";
  const go = (nextLang: HelpLocale) => {
    const path = topicId ? `/help/${nextLang}/${topicId}` : `/help/${nextLang}${groupQuery}`;
    window.history.pushState(null, "", path);
    setRoute(parsePath(nextLang));
  };
  const grouped = group ? data.topics.filter(item =>
    item.type === group || collections[group]?.includes(item.id)) : [];
  const featured = data.topics.find(item => item.id === "facilitation.vote");
  const featuredHtml = featured?.html[lang] ?? featured?.html.ru;
  const featuredSteps = useMemo(() => {
    if (!featuredHtml) return [];
    const content = new DOMParser().parseFromString(featuredHtml, "text/html");
    const steps = Array.from(content.querySelector("ol")?.children ?? [], item => (item.textContent ?? "").trim());
    // The full guide opens with an optional shared timer. The excerpt groups opening and
    // configuring the vote into one step and keeps the canonical start-button instruction.
    if (steps.length !== 5) return steps.slice(0, 3);
    const [, select, open, configure, start] = steps;
    return [select, [open, configure].join(" "), start];
  }, [featuredHtml]);
  const articles = results ?? (group ? grouped.map(item => ({
    id: item.id, title: item.title[lang], summary: item.summary[lang],
  })) : null);

  return (
    <div className="help-page">
      <header className="help-topbar">
        <a className="help-brand" href="/" aria-label={brandName({ locale: lang, productName })}>
          <BrandMark size={28} />
        </a>
        <a className="help-back" href="/">{t("help.back")}</a>
        <ThemeSwitch />
        {/* The help centre is public; support is not. The entry asks the session before it
            draws anything (ADR-250 §2.4). */}
        <SupportEntryButton requireSession>{t("support.write")}</SupportEntryButton>
        <nav className="help-langs" aria-label={t("help.language")}>
          {(["ru", "en"] as const).map((code) => (
            <button
              key={code}
              type="button"
              className={code === lang ? "active" : undefined}
              aria-pressed={code === lang}
              onClick={() => go(code)}
            >
              {code.toUpperCase()}
            </button>
          ))}
        </nav>
      </header>

      <main className="help-main">
        {topic ? (
          <article className="help-article">
            <nav className="help-crumbs" aria-label={t("help.title")}>
              <a href={`/help/${lang}`}>{t("help.title")}</a>
              <span aria-hidden="true">/</span>
              <span>{topic.title[lang]}</span>
            </nav>
            {status !== "current" && (
              <p className="help-notice" role="status">
                {status === "missing" ? t("help.translationMissing") : t("help.translationOutdated")}
              </p>
            )}
            <span className="help-type" data-type={topic.type}>{t(`help.types.${topic.type}`)}</span>
            <h1>{topic.title[lang]}</h1>
            <p className="help-summary">{topic.summary[lang]}</p>
            {body ? (
              <div className="help-body" dangerouslySetInnerHTML={{ __html: body }} />
            ) : (
              <p className="help-notice" role="alert">{t("help.topicNotFound")}</p>
            )}
            {topic.related.length > 0 && (
              <aside className="help-related">
                <h2>{t("help.related")}</h2>
                <ul>
                  {topic.related.map((id) => {
                    const related = data.topics.find((candidate) => candidate.id === id);
                    return related ? (
                      <li key={id}><a href={`/help/${lang}/${id}`}>{related.title[lang]}</a></li>
                    ) : null;
                  })}
                </ul>
              </aside>
            )}
          </article>
        ) : (
          <>
            <div className="help-hero">
              <h1>{t("help.title")}</h1>
              <label className="help-search">
                <Icon name="search" size={20} />
                <span className="rm-sr">{t("help.search")}</span>
                <input
                  type="search"
                  value={query}
                  placeholder={t("help.searchPlaceholder")}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
            </div>

            {!results && (
              <nav className="help-categories" aria-label={t("help.categories")}>
                {TYPES.map(type => (
                  <a key={type} className="help-category" data-type={type}
                    href={`/help/${lang}?type=${type}`} aria-current={group === type ? "page" : undefined}>
                    <strong>{t(`help.types.${type}`)}</strong>
                    <span>{t(`help.examples.${type}`)}</span>
                  </a>
                ))}
              </nav>
            )}
            {articles && (
              <section className="help-section" aria-labelledby="help-list-heading">
                <h2 id="help-list-heading">{group && !results ? t(`help.types.${group}`) : t("help.results")}</h2>
                {articles.length === 0 ? <p className="help-notice" role="status">{t("help.noResults")}</p> : (
                  <ul className="help-list">
                    {articles.map(item => (
                      <li key={item.id}>
                        <a href={`/help/${lang}/${item.id}`}>{item.title}</a>
                        <p>{item.summary}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
            {featured && !group && !results?.length && (
              <article className="help-featured">
                <span className="help-type" data-type={featured.type}>{t(`help.types.${featured.type}`)}</span>
                <h2 id="help-featured-title">{featured.title[lang]}</h2>
                {featuredSteps.length > 0
                  ? <ol>{featuredSteps.map(step => <li key={step}>{step}</li>)}</ol>
                  : <p>{featured.summary[lang]}</p>}
                {lang === "en" && featured.translationStatus !== "current" && (
                  <p className="help-notice" role="status">{featured.translationStatus === "missing"
                    ? t("help.translationMissing") : t("help.translationOutdated")}</p>
                )}
                <a href={`/help/${lang}/${featured.id}`} aria-describedby="help-featured-title">{t("help.readArticle")}</a>
                <nav className="help-featured-related" aria-label={t("help.related")}>
                  <span>{t("help.related")}</span>
                  {featured.related.map(id => {
                    const related = data.topics.find(item => item.id === id);
                    return related && <a key={id} href={`/help/${lang}/${id}`}>{related.title[lang]}</a>;
                  })}
                </nav>
              </article>
            )}
          </>
        )}
      </main>
      <footer className="help-about">
        <span>{aboutLabel(lang, productName)}</span>
        <span>© {ABOUT.year} {ABOUT.author}</span>
        <a href={`/help/${lang}/about.remo`}>{ABOUT.license}</a>
        <a href={ABOUT.source} rel="noopener">{t("about.source")}</a>
        {/* §6.3: the same entry as on the home, next to the other quiet footer links. */}
        <ConsentLink className="help-consent" />
      </footer>
    </div>
  );
}
