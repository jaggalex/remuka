#!/usr/bin/env node
/**
 * Acceptance probe for the rebrand on live hosts (ADR-254, `spec/rebrand.md` §10,
 * `spec/rebrand-fixes.md` §10, `spec/rebrand-acceptance.md`).
 *
 * It only reads: GET requests, never a write, never a
 * credential. Each check prints PASS, FAIL, WARN or MANUAL with the reason and the spec
 * section. Exit code 1 when any FAIL.
 *
 *   node scripts/accept-rebrand.mjs
 *   EXPECT_VERSION=0.8.0 node scripts/accept-rebrand.mjs
 *   APP=app.remuka.com OLD_APP=remo.letii.ru node scripts/accept-rebrand.mjs
 *   node scripts/accept-rebrand.mjs --json
 *
 * Hosts default to the cloud map of `spec/rebrand.md` §5; override any with env.
 */

const H = {
  SITE_EU: process.env.SITE_EU ?? "remuka.com",
  SITE_RU: process.env.SITE_RU ?? "remuka.ru",
  APP: process.env.APP ?? "app.remuka.com",
  APP_RU: process.env.APP_RU ?? "app.remuka.ru",
  DOCS: process.env.DOCS ?? "docs.remuka.com",
  OLD_APP: process.env.OLD_APP ?? "remo.letii.ru",
  OLD_DOCS: process.env.OLD_DOCS ?? "docs.remo.letii.ru",
};
const EXTRA_TLS = (process.env.EXTRA_HOSTS ?? "www.remuka.com,www.remuka.ru,docs.remuka.ru")
  .split(",")
  .map((h) => h.trim())
  .filter(Boolean);
const RESERVED = (process.env.RESERVED_HOSTS ?? "api.remuka.com,api.remuka.ru").split(",").map((h) => h.trim()).filter(Boolean);
const EXPECT_VERSION = process.env.EXPECT_VERSION ?? "0.8.0";
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS ?? 10000);
const JSON_OUT = process.argv.includes("--json");

const results = [];
function record(status, id, title, detail, ref) {
  results.push({ status, id, title, detail, ref });
}

async function get(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { redirect: "manual", signal: controller.signal, ...init });
    const text = response.status >= 300 && response.status < 400 ? "" : await response.text();
    return { ok: true, status: response.status, headers: response.headers, text };
  } catch (error) {
    const cause = error?.cause?.code ?? error?.cause?.message ?? error?.message ?? String(error);
    return { ok: false, error: cause };
  } finally {
    clearTimeout(timer);
  }
}

function titleOf(html) {
  return /<title>([^<]*)<\/title>/i.exec(html ?? "")?.[1]?.trim() ?? "";
}

function versionAtLeast(actual, wanted) {
  const a = String(actual).split(/[.-]/).map(Number);
  const w = String(wanted).split(/[.-]/).map(Number);
  for (let i = 0; i < 3; i += 1) {
    if ((a[i] ?? 0) > (w[i] ?? 0)) return true;
    if ((a[i] ?? 0) < (w[i] ?? 0)) return false;
  }
  return true;
}

const isRedirect = (s) => s >= 300 && s < 400;

async function checkTls(host) {
  const r = await get(`https://${host}/`);
  if (!r.ok) record("FAIL", `tls:${host}`, `TLS and answer on ${host}`, `no answer: ${r.error}`, "§5");
  else record("PASS", `tls:${host}`, `TLS and answer on ${host}`, `HTTP ${r.status}`, "§5");
  return r;
}

async function checkApp(host, zone) {
  const root = await get(`https://${host}/`);
  if (root.ok && isRedirect(root.status)) {
    record("FAIL", `app.root:${zone}`, `${host} serves the app (${zone})`, `answers ${root.status} → ${root.headers.get("location")}. The app lives on ${host}; a 308 from it is cached by browsers and hard to undo`, "rebrand §5.1");
  } else if (root.ok) {
    const title = titleOf(root.text);
    record(/Remuka|Ремука/.test(title) ? "PASS" : "FAIL", `app.title:${zone}`, `${host}: title is the new name`, `«${title}»`, "rebrand §4.1");
  }
  const health = await get(`https://${host}/api/health`);
  let body = {};
  try { body = health.ok ? JSON.parse(health.text) : {}; } catch { body = {}; }
  if (health.ok && health.status === 200 && body.version && versionAtLeast(body.version, EXPECT_VERSION)) {
    record("PASS", `app.version:${zone}`, `${host}: build ${EXPECT_VERSION} or newer`, `version ${body.version}, schema ${body.schema}, commit ${String(body.commit).slice(0, 8)}, name ${body.name ?? "—"}`, "rebrand §10");
  } else {
    record("FAIL", `app.version:${zone}`, `${host}: build ${EXPECT_VERSION} or newer`, health.ok ? `GET /api/health → ${health.status}${body.version ? `, version ${body.version} (schema ${body.schema})` : ""}: the new build is not deployed` : health.error, "rebrand §10");
  }
  const config = await get(`https://${host}/api/config`);
  let cfg = null;
  try { cfg = config.ok ? JSON.parse(config.text) : null; } catch { cfg = null; }
  if (cfg && "productName" in cfg) record("PASS", `app.config:${zone}`, `${host}: /api/config answers JSON`, JSON.stringify(cfg), "rebrand §3");
  else record("FAIL", `app.config:${zone}`, `${host}: /api/config answers JSON`, config.ok ? `got: ${config.text.slice(0, 80) || config.status}` : config.error, "rebrand §3");
  if (cfg?.compliance?.zone && cfg.compliance.zone !== zone.toLowerCase()) {
    record("FAIL", `app.zone:${zone}`, `${host}: compliance zone is ${zone.toLowerCase()}`, `zone ${cfg.compliance.zone}`, "cookies §3");
  }
  if (zone === "EU" && cfg?.move) {
    const okMove = /^https:\/\//.test(cfg.move.to ?? "") && /^\d{4}-\d{2}-\d{2}$/.test(cfg.move.at ?? "");
    record(okMove ? "PASS" : "FAIL", "app.move", "Move announcement in /config is well formed", JSON.stringify(cfg.move), "fixes §1");
  } else if (zone === "EU") {
    record("MANUAL", "app.move", "Move banner", "no `move` in /config: set REMO_APP_MOVE_TO and REMO_APP_MOVE_AT 7 days before the move and re-run", "fixes §1");
  }
  return root;
}

async function main() {
  // 1. Every host in the map answers over valid TLS.
  for (const host of [...new Set([...Object.values(H), ...EXTRA_TLS])]) await checkTls(host);

  // 2. Both installations serve the app itself and the new build (rebrand §5.1).
  const appRoot = await checkApp(H.APP, "EU");
  await checkApp(H.APP_RU, "RU");

  // Reserved hosts: no DNS until they get a purpose (owner decision 2026-11-22).
  for (const host of RESERVED) {
    const r = await get(`https://${host}/`);
    if (!r.ok && /ENOTFOUND|EAI_AGAIN/.test(r.error)) record("PASS", `reserved:${host}`, `${host} has no DNS record yet`, "not resolved", "rebrand §5");
    else record("WARN", `reserved:${host}`, `${host} has no DNS record yet`, r.ok ? `answers HTTP ${r.status}` : `resolves, but ${r.error}: remove the record until it has a purpose`, "rebrand §5");
  }

  const mark = await get(`https://${H.APP}/remuka-mark.svg`);
  record(mark.ok && mark.status === 200 && /svg/.test(mark.headers.get("content-type") ?? "") ? "PASS" : "FAIL", "app.icon", "New icon /remuka-mark.svg", mark.ok ? `${mark.status} ${mark.headers.get("content-type")}` : mark.error, "rebrand §4.1");
  const oldMark = await get(`https://${H.APP}/remo-logo.svg`);
  record(oldMark.ok && oldMark.status === 200 ? "PASS" : "FAIL", "app.oldicon", "Old icon path still served", oldMark.ok ? String(oldMark.status) : oldMark.error, "rebrand §6");

  const hsts = appRoot.ok ? appRoot.headers.get("strict-transport-security") : null;
  record(hsts ? "PASS" : "FAIL", "app.hsts", "HSTS on the app", hsts ?? "missing", "rebrand §9 этап 0");

  const sec = await get(`https://${H.APP}/.well-known/security.txt`);
  const secOk = sec.ok && sec.status === 200 && /text\/plain/.test(sec.headers.get("content-type") ?? "") && /Contact:\s*mailto:security@remuka\.com/i.test(sec.text);
  record(secOk ? "PASS" : "WARN", "app.securitytxt", "security.txt with security@remuka.com", sec.ok ? `${sec.status} ${sec.headers.get("content-type")}` : sec.error, "fixes §7 (after the move)");

  // 3. The old app host: pages 301 with the same path; API, MCP and sync proxied.
  const oldPage = await get(`https://${H.OLD_APP}/r/acceptance-probe?x=1`);
  const wantPage = `https://${H.APP}/r/acceptance-probe?x=1`;
  if (!oldPage.ok) record("FAIL", "old.page", "Old page redirects to the app, same path", oldPage.error, "rebrand §6");
  else if (isRedirect(oldPage.status) && oldPage.headers.get("location") === wantPage) {
    record(oldPage.status === 301 ? "PASS" : "WARN", "old.page", "Old page redirects to the app, same path", `${oldPage.status} → ${wantPage}${oldPage.status === 301 ? "" : " (spec says 301)"}`, "rebrand §6");
  } else {
    record("FAIL", "old.page", "Old page redirects to the app, same path", `${oldPage.status} → ${oldPage.headers.get("location") ?? "—"}, expected 301 → ${wantPage}`, "rebrand §6");
  }

  for (const [id, path] of [["old.api", "/api/health"], ["old.mcp", "/mcp"]]) {
    const r = await get(`https://${H.OLD_APP}${path}`);
    if (!r.ok) { record("FAIL", id, `Old ${path} is proxied, not redirected`, r.error, "rebrand §6"); continue; }
    if (isRedirect(r.status)) {
      record("FAIL", id, `Old ${path} is proxied, not redirected`, `${r.status} → ${r.headers.get("location")}. Clients drop the Authorization header on a cross-host redirect, so tokens and MCP break`, "rebrand §6");
      continue;
    }
    const dep = r.headers.get("deprecation");
    const link = r.headers.get("link") ?? "";
    record(dep && link.includes(H.APP) ? "PASS" : "FAIL", id, `Old ${path} is proxied with Deprecation and Link`, `HTTP ${r.status}, Deprecation: ${dep ?? "—"}, Link: ${link || "—"}`, "rebrand §6");
  }
  record("MANUAL", "old.ws", "Old WebSocket proxied; after REMO_APP_ORIGIN_MOVED a tab is moved by 4001", "see spec/rebrand-acceptance.md, step 5.4", "rebrand §6, fixes §8");

  // 4. Docs.
  const oldDoc = await get(`https://${H.OLD_DOCS}/guide/ru/overview/index.html`);
  const wantDoc = `https://${H.DOCS}/guide/ru/overview/index.html`;
  if (oldDoc.ok && isRedirect(oldDoc.status) && oldDoc.headers.get("location") === wantDoc) {
    record(oldDoc.status === 301 ? "PASS" : "WARN", "docs.old", "Old docs redirect with the same path", `${oldDoc.status} → ${wantDoc}${oldDoc.status === 301 ? "" : " (spec says 301)"}`, "rebrand §6");
  } else {
    record("FAIL", "docs.old", "Old docs redirect with the same path", oldDoc.ok ? `${oldDoc.status} → ${oldDoc.headers.get("location") ?? "—"}` : oldDoc.error, "rebrand §6");
  }
  const docTitle = await get(wantDoc);
  if (docTitle.ok) {
    const t = titleOf(docTitle.text);
    record(/Remuka|Ремук/.test(t) ? "PASS" : "FAIL", "docs.title", "Docs carry the new name", `title «${t}»`, "rebrand §4.4");
  }
  const llms = await get(`https://${H.DOCS}/guide/llms.txt`);
  if (llms.ok && llms.status === 200) {
    const old = /letii\.ru/.test(llms.text);
    record(old ? "FAIL" : "PASS", "docs.llms", "llms.txt links only to new hosts", old ? "contains letii.ru" : "no letii.ru", "rebrand §10");
  } else record("FAIL", "docs.llms", "llms.txt answers", llms.ok ? String(llms.status) : llms.error, "rebrand §10");

  // 6. Sites and www.
  for (const [site, app] of [[H.SITE_EU, H.APP], [H.SITE_RU, H.APP_RU]]) {
    const r = await get(`https://${site}/`);
    if (!r.ok) record("FAIL", `site:${site}`, `${site} answers`, r.error, "rebrand §5");
    else if (r.status === 302 && (r.headers.get("location") ?? "").startsWith(`https://${app}`)) {
      record("PASS", `site:${site}`, `${site}: temporary 302 to ${app} until the site exists`, `302 → ${r.headers.get("location")}`, "rebrand §11.6");
    } else if (isRedirect(r.status)) {
      record("FAIL", `site:${site}`, `${site}: only a temporary 302 to ${app}`, `${r.status} → ${r.headers.get("location") ?? "—"}`, "rebrand §11.6");
    } else {
      const servesApp = /<div id="root"|\/assets\/index-/.test(r.text);
      record(servesApp ? "WARN" : "PASS", `site:${site}`, `${site} is the site, not the app`, servesApp ? `serves the app («${titleOf(r.text)}»): should be the site or a 302 to ${app}` : `title «${titleOf(r.text)}»`, "rebrand §5");
    }
    const w = await get(`https://www.${site}/`);
    const wl = w.ok ? w.headers.get("location") ?? "" : "";
    record(w.ok && w.status === 301 && wl.startsWith(`https://${site}`) ? "PASS" : "FAIL", `www:${site}`, `www.${site} → 301 to ${site}`, w.ok ? `${w.status} → ${wl || "—"}` : w.error, "rebrand §5");
  }

  // Report.
  const order = { FAIL: 0, WARN: 1, MANUAL: 2, PASS: 3 };
  results.sort((a, b) => order[a.status] - order[b.status]);
  if (JSON_OUT) {
    process.stdout.write(`${JSON.stringify({ hosts: H, results }, null, 2)}\n`);
  } else {
    for (const r of results) {
      process.stdout.write(`${r.status.padEnd(6)} ${r.title}\n       ${r.detail}  [${r.ref}]\n`);
    }
    const count = (s) => results.filter((r) => r.status === s).length;
    process.stdout.write(`\n${count("PASS")} pass, ${count("FAIL")} fail, ${count("WARN")} warn, ${count("MANUAL")} manual\n`);
  }
  process.exitCode = results.some((r) => r.status === "FAIL") ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 2;
});
