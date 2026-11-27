/** Public release artifact. The signing private key is supplied by the release environment. */
import { createHash, createPrivateKey, sign } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { headings, markdown, translationHash, withHeadingIds } from "./docs-core.mjs";
import { SCHEMA_VERSION } from "../apps/sync/schema-version.mjs";

const root = realpathSync(fileURLToPath(new URL("../", import.meta.url)));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(k => JSON.stringify(k) + ":" + canonical(value[k])).join(",")}}`;
  return JSON.stringify(value);
}
function source(path) {
  const abs = join(root, path);
  if (realpathSync(abs) !== abs) throw new Error(`symlink in knowledge source: ${path}`);
  return readFileSync(abs, "utf8");
}
const git = (...args) => execFileSync("git", args, {cwd: root, encoding:"utf8"}).trim();
export function buildArtifact({commit,release,builtAt,privateKey}) {
  const sections = JSON.parse(source("guide/sections.json"));
  const documents = [], files = Object.create(null);
  const parser = withHeadingIds(markdown());
  function include(dir, meta, kind, audience) {
    if (meta.knowledgeReview && (kind !== "guide" || !meta.id.startsWith("support/") ||
        !/^[a-z0-9][a-z0-9.-]{0,95}$/.test(meta.knowledgeReview.source) || !Number.isFinite(Date.parse(meta.knowledgeReview.expires_at)))) {
      throw new Error(`invalid review provenance: ${dir}`);
    }
    if (!/^[a-z0-9.-]+(?:\/[a-z0-9-]+)?$/.test(meta.id)) throw new Error("invalid knowledge document ID");
    const ru = source(`${dir}/ru.md`), en = source(`${dir}/en.md`);
    const reviewed = meta.translations?.en;
    if (!en.trim() || !ru.trim() || translationHash(meta, "ru", ru) !== reviewed?.sourceHash ||
        translationHash(meta, "en", en) !== reviewed?.targetHash) throw new Error(`stale translation: ${dir}`);
    for (const [locale, body] of Object.entries({ru,en})) {
      const path = `${dir}/${locale}.md`;
      const url = kind === "guide" ? `/guide/${locale}/${meta.id}.html` : `/help/${locale}/${meta.id}`;
      documents.push({doc_id:`${kind}/${meta.id}`, locale, title:meta.title[locale], audience,
        source_type:kind, url, headings:kind === "guide" ? headings(parser, body).map(({text,id}) => ({text,id})) : [],
        ...(meta.knowledgeReview ? {review:{source:meta.knowledgeReview.source,expires_at:meta.knowledgeReview.expires_at}} : {}),
        path, sha256:sha(body), translation_status: locale === "ru" ? "source" : "reviewed"});
      files[path] = body;
    }
  }
  for (const section of sections) {
    for (const entry of readdirSync(join(root, "guide", section.id), {withFileTypes:true})) {
      if (!entry.isDirectory()) continue;
      const dir = `guide/${section.id}/${entry.name}`;
      const meta = JSON.parse(source(`${dir}/meta.json`));
      if (meta.id !== `${section.id}/${entry.name}`) throw new Error("guide id/path disagreement");
      if (meta.status === "planned") continue;
      const admin = ["admin", "operator"].includes(section.id) ||
        ["reference/api", "reference/events", "reference/env", "support/migrations"].includes(meta.id);
      include(dir, meta, "guide", admin ? "admin" : "end_user");
    }
  }
  for (const entry of readdirSync(join(root, "content/help"), {withFileTypes:true})) {
    if (!entry.isDirectory()) continue;
    const dir = `content/help/${entry.name}`;
    const meta = JSON.parse(source(`${dir}/topic.json`));
    if (meta.id !== entry.name) throw new Error("help id/path disagreement");
    if (meta.audience === "public") include(dir, meta, "help", "end_user");
  }
  documents.sort((a,b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const archive = gzipSync(canonical(files), {level:9});
  const payload = {format_version:1, build_id:`${release}@${commit}`, product_release:release,
    product_commit:commit, docs_commit:commit, schema_version:SCHEMA_VERSION, built_at:builtAt,
    locales:["ru","en"], archive_sha256:sha(archive), documents};
  const data = Buffer.from(canonical(payload));
  if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("Ed25519 signing key required");
  const manifest = {...payload, manifest_id:sha(data), signature:sign(null, data, privateKey).toString("base64")};
  return {archive,manifest};
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const out = process.argv[2];
  if (!out || !process.env.SUPPORT_KNOWLEDGE_SIGNING_KEY_FILE) {
    throw new Error("Usage: SUPPORT_KNOWLEDGE_SIGNING_KEY_FILE=/secret/ed25519.pem pnpm guide:knowledge /output/directory");
  }
  if (git("status", "--porcelain", "--untracked-files=all", "--", "guide", "content/help", "scripts", "packages/brand", "apps/sync/schema-version.mjs", "package.json")) {
    throw new Error("Build release knowledge from a clean committed source checkout");
  }
  const commit = git("rev-parse", "HEAD");
  const release = process.env.REMO_VERSION || JSON.parse(source("package.json")).version;
  const builtAt = new Date(git("show", "-s", "--format=%cI", "HEAD")).toISOString();
  const privateKey = createPrivateKey(readFileSync(process.env.SUPPORT_KNOWLEDGE_SIGNING_KEY_FILE));
  const {archive,manifest}=buildArtifact({commit,release,builtAt,privateKey});
  mkdirSync(resolve(out), {recursive:true});
  writeFileSync(join(out, "support-knowledge.json.gz"), archive);
  writeFileSync(join(out, "support-knowledge.manifest.json"), JSON.stringify(manifest) + "\n");
  console.log(`knowledge: ${manifest.documents.length} documents, manifest ${manifest.manifest_id}`);
}
