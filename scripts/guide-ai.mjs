function absoluteLinks(body, locale, guide, app) {
  return body
    .replace(/\]\(\/guide\/([a-z0-9-]+)\/([a-z0-9-]+)(#[^)]*)?\)/g,
      (_, section, slug, anchor = "") => `](${guide}/${locale}/${section}/${slug}.html${anchor})`)
    .replace(/\]\(\/help\/([a-z0-9.-]+)(#[^)]*)?\)/g,
      (_, topic, anchor = "") => `](${app}/help/${locale}/${topic}${anchor})`)
    .replace(/\]\(\/guide\/([^)]+)\)/g, (_, path) => `](${guide}/${path})`);
}

export function aiExports({ ordered, sections, brand, guide, app, updated, schema }) {
  const files = new Map();
  for (const locale of ["ru", "en"]) {
    const ru = locale === "ru";
    const title = brand.name[locale];
    const date = ru
      ? `Обновлено: ${updated}. Версия схемы: ${schema}. Страниц: ${ordered.length}.`
      : `Content updated: ${updated}. Schema version: ${schema}. Pages: ${ordered.length}.`;
    const intro = ru
      ? `Публичное руководство по совместной работе в ${brand.cases?.ru?.prepositional ?? brand.name.ru}.`
      : `Public documentation for teams working together in ${brand.name.en}.`;
    const map = [`# ${title}`, "", `> ${intro}`, "",
      `${ru ? "Полный текст" : "Full text"}: ${guide}/llms-full.${locale}.txt`, date, ""];
    const full = [ru ? `# Документация: ${title}` : `# ${title} documentation`, "",
      `> ${intro}`, `> ${guide}/llms.${locale}.txt`, `> ${date}`, ""];
    for (const section of sections) {
      map.push(`## ${section.title[locale]}`, "");
      for (const page of ordered.filter(p => p.section === section.id)) {
        const url = `${guide}/${locale}/${page.section}/${page.slug}.html`;
        map.push(`- [${page.meta.title[locale]}](${url}) — ${page.meta.summary[locale]}`);
        full.push(`## ${page.meta.title[locale]}`, "", `${ru ? "Источник" : "Source"}: ${url}`, "",
          absoluteLinks(page.bodies[locale], locale, guide, app).trim(), "", "---", "");
      }
      map.push("");
    }
    map.push(ru ? "## Примечания" : "## Notes", "",
      `${ru ? "Встроенная справка" : "In-app help"}: ${app}/help/${locale}`, "");
    files.set(`llms.${locale}.txt`, map.join("\n"));
    files.set(`llms-full.${locale}.txt`, full.join("\n"));
  }
  const formats = ["llms.ru", "llms-full.ru", "llms.en", "llms-full.en", "llms-full"];
  files.set("llms.txt", files.get("llms.en.txt") + formats.map(f => `- ${guide}/${f}.txt`).join("\n") + "\n");
  files.set("llms-full.txt", files.get("llms-full.en.txt"));
  return files;
}
