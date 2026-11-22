/**
 * The legal registry of a running installation (ADR-256, `spec/legal-acceptance.md` §4).
 *
 * The registry is a file tree, not a table: `content/legal/index.json` names the current
 * revision of every document and `content/legal/<zone>/<doc>/<version>.<lang>.md` holds
 * the text. One installation reads its own zone only; the service never learns another
 * zone's documents, and no copy of the registry is written into the database.
 *
 * Four things are decided here, once, so the public configuration, the registration
 * route and the start guard cannot disagree:
 *
 *   - what `GET /config` publishes (`legalConfig`): doc, zone, current version, the hash
 *     of that revision, its effective date, whether sign-up requires it, whether a new
 *     revision asks again, whether it is a draft, whether it can be withdrawn, and the
 *     address of the page;
 *   - whether `POST /auth/register` may proceed (`legalAcceptanceProblem`) — a missing
 *     document is `LEGAL_ACCEPTANCE_REQUIRED`, a wrong version or hash is
 *     `LEGAL_VERSION_CHANGED`, and either answer comes before rate limiting and scrypt;
 *   - which rows the registration writes (`legalAcceptanceRows`): the values come from
 *     the registry, never from the request, so the journal cannot record a revision that
 *     was never published;
 *   - whether a production installation may start with a required draft
 *     (`assertLegalDrafts`).
 *
 * The hash is per revision (`sha256: { "<version>": "<hex>" }`) and stays that way: a new
 * revision leaves the earlier hash alone, so every accepted revision remains provably
 * unchanged. One revision is one language — a bilingual document is two revisions, not
 * one hash with two meanings.
 *
 * The address policy is a setting because the two zones differ (`legalIpPolicy`): only a
 * keyed digest is ever written, the EU installation keeps none by default, and the
 * Russian one keeps it for three years unless the operator says otherwise. A retention
 * pass clears older digests; deleting an account clears them at once (ADR-257).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  legalDocumentPath,
  legalDocuments,
  legalPageUrl,
  legalTextSha256,
  readLegalIndex,
  recordedHash,
} from "@remo/legal";
import { BRAND } from "@remo/brand";
import { cookiePolicyUrl, resolveCompliance } from "./compliance.mjs";
import { createLegalNoticeLoop } from "./legal-notice.mjs";
import { assertLegalDraftsFlag, legalDraftsAllowed } from "./stage.mjs";

/** The address the client is given in development when the operator set none. */
export const DEFAULT_LEGAL_ORIGIN = "http://localhost:5173";

/** Three years is the Russian installation's default (1095 days). */
export const DEFAULT_RU_IP_RETENTION_DAYS = 1095;

/** A day, for the retention pass; an hour would be a write every hour for nothing. */
export const LEGAL_IP_RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * The repository root that holds `content/legal/`.
 *
 * The service runs from `apps/sync` in development and from `/app` in the container, so
 * the candidates are the explicit `REMO_LEGAL_ROOT`, the repository root relative to the
 * working directory, and the working directory itself. The first candidate with the
 * registry wins; nothing is guessed when a zone needs it.
 */
export function legalRegistryRoot(env = process.env, cwd = process.cwd()) {
  const explicit = String(env.REMO_LEGAL_ROOT ?? "").trim();
  const candidates = [explicit || null, join(cwd, "..", ".."), cwd].filter(Boolean);
  for (const candidate of candidates) {
    if (existsSync(join(candidate, "content", "legal", "index.json"))) return candidate;
  }
  return null;
}

/** The SHA-256 of a document's current revision: recorded for published, computed for a draft. */
function currentSha256(root, entry) {
  const recorded = recordedHash(entry, entry.current);
  if (recorded) return recorded;
  const lang = entry.lang?.[0];
  if (!lang) return null;
  const path = legalDocumentPath(root, entry.zone, entry.doc, entry.current, lang);
  if (!existsSync(path)) return null;
  return legalTextSha256(readFileSync(path, "utf8"));
}

/**
 * One document as this installation sees it. `status` stays internal: the wire shape is
 * the five decisions plus the address (`legalConfig`).
 */
function describeDocument(root, entry, origin) {
  return {
    doc: entry.doc,
    zone: entry.zone,
    version: entry.current,
    sha256: currentSha256(root, entry),
    // The letter names the document in the recipient's language; the public wire shape
    // (`legalConfig`) deliberately drops the title.
    title: entry.title ?? {},
    required: entry.required,
    reaccept: entry.reaccept,
    status: entry.status,
    effective: entry.effective ?? null,
    withdrawable: entry.withdrawable === true,
    url: legalPageUrl(origin, entry.doc),
  };
}

/**
 * Read the registry of one zone.
 *
 * `zone: "none"` is the safe default and has no documents at all — a self-host installation
 * that has not chosen a jurisdiction is not shown a checkbox that claims one. A named zone
 * without a readable registry is a start failure, not an empty form: the form would ask for
 * nothing and the server would enforce nothing.
 */
export function resolveLegal(
  env = process.env,
  { zone, origin = DEFAULT_LEGAL_ORIGIN, cwd = process.cwd() } = {},
) {
  const effective = zone ?? resolveCompliance(env).zone;
  if (effective === "none") {
    return { zone: "none", root: null, documents: [], ipPolicy: legalIpPolicy(env, "none") };
  }
  const root = legalRegistryRoot(env, cwd);
  if (!root) {
    throw new Error(
      `[legal] content/legal/index.json not found while REMO_COMPLIANCE_ZONE=${effective}; ` +
        "set REMO_LEGAL_ROOT to the checkout or ship content/legal with the service",
    );
  }
  const index = readLegalIndex(root);
  const documents = legalDocuments(index, effective).map((entry) =>
    describeDocument(root, entry, origin),
  );
  const incomplete = documents.filter(
    (document) => document.required === "signup" && !document.sha256,
  );
  if (incomplete.length) {
    throw new Error(
      `[legal] no text for required document(s) ${incomplete
        .map((document) => `${document.zone}/${document.doc}`)
        .join(", ")}; run pnpm legal:check`,
    );
  }
  return {
    zone: effective,
    root,
    documents: documents.filter((document) => document.sha256),
    ipPolicy: legalIpPolicy(env, effective),
  };
}

/** The `legal` field of `GET /config`: only this zone, with the decisions a client needs. */
export function legalConfig(legal) {
  return {
    documents: (legal?.documents ?? []).map(
      ({
        doc,
        zone,
        version,
        sha256,
        effective,
        required,
        reaccept,
        status,
        withdrawable,
        url,
      }) => ({
        doc,
        zone,
        version,
        sha256,
        effective,
        required,
        reaccept,
        status,
        withdrawable,
        url,
      }),
    ),
  };
}

/** Documents the form must show as a checkbox of this zone. */
export function requiredDocuments(legal) {
  return (legal?.documents ?? []).filter((document) => document.required === "signup");
}

/**
 * Why a set of documents is not satisfied by `acceptances`, or null.
 *
 * A malformed entry is not a third error: it simply does not satisfy a document. A
 * document from another zone does not satisfy anything here, which is what makes a
 * mixed-up client fail as "the required document is missing". The current values travel
 * with both errors, so the client can re-read `/config` and ask again without guessing.
 */
export function acceptanceProblem(documents, acceptances) {
  const required = documents ?? [];
  if (!required.length) return null;

  const seen = new Map();
  if (Array.isArray(acceptances)) {
    for (const item of acceptances) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      if (typeof item.doc !== "string" || !item.doc) continue;
      seen.set(item.doc, {
        version: Number(item.version),
        sha256: String(item.sha256 ?? "").toLowerCase(),
      });
    }
  }

  const current = required.map(({ doc, version, sha256 }) => ({ doc, version, sha256 }));
  const missing = required.filter((document) => !seen.has(document.doc)).map((d) => d.doc);
  if (missing.length) {
    return {
      code: "LEGAL_ACCEPTANCE_REQUIRED",
      message: "accept the required documents before creating an account",
      missing,
      documents: current,
    };
  }

  const changed = required
    .filter((document) => {
      const accepted = seen.get(document.doc);
      return accepted.version !== document.version || accepted.sha256 !== document.sha256;
    })
    .map((document) => document.doc);
  if (changed.length) {
    return {
      code: "LEGAL_VERSION_CHANGED",
      message: "read the current revision of the changed document and accept it",
      missing: [],
      documents: current,
    };
  }
  return null;
}

/** A sign-up must satisfy every document the zone requires at sign-up (§4). */
export function legalAcceptanceProblem(legal, acceptances) {
  return acceptanceProblem(requiredDocuments(legal), acceptances);
}

/**
 * Whether a revision is in force on `today`.
 *
 * An entry without an effective date is the historical shape (drafts and the first
 * release): it is in force, so existing accounts meet the window at once. A revision
 * whose date is still ahead is announced by the banner and the letter, not by the
 * blocking window (§5).
 */
export function legalRevisionInForce(effective, today = new Date()) {
  if (!effective) return true;
  const at = today instanceof Date ? today : new Date(today);
  if (Number.isNaN(at.getTime())) return true;
  return String(effective) <= at.toISOString().slice(0, 10);
}

/**
 * Documents whose current revision a signed-in person has not accepted.
 *
 * `rows` are the latest journal rows per document (`latestLegalAcceptances`). A withdrawal
 * is the latest row, so it leaves the document unaccepted. An account that never accepted
 * anything is pending on every sign-up document and on every `reaccept` document that is
 * already in force, which is how existing accounts meet the window at their first
 * sign-in (§5). A revision with a future effective date is not pending yet.
 */
export function pendingAcceptanceDocuments(legal, rows, today = new Date()) {
  const latest = new Map((rows ?? []).map((row) => [row.doc, row]));
  return (legal?.documents ?? []).filter((document) => {
    // The window shows the same documents the form asks for: anything required at sign-up,
    // plus any revision with `reaccept: true` (§3, §5).
    if (document.required !== "signup" && document.reaccept !== true) return false;
    if (!legalRevisionInForce(document.effective, today)) return false;
    const row = latest.get(document.doc);
    return (
      !row ||
      row.event === "withdraw" ||
      row.zone !== document.zone ||
      Number(row.version) !== document.version ||
      row.sha256 !== document.sha256
    );
  });
}

/** One document of this installation by id, or null. */
export function legalDocumentById(legal, doc) {
  return (legal?.documents ?? []).find((document) => document.doc === doc) ?? null;
}

/**
 * The rows a successful registration writes: the required documents of this zone, with
 * the values this installation publishes. A request cannot add a document the server did
 * not ask for, nor name a revision with a hash the registry does not carry.
 */
export function legalAcceptanceRows(legal) {
  return requiredDocuments(legal).map(({ zone, doc, version, sha256 }) => ({
    zone,
    doc,
    version,
    sha256,
  }));
}

/** Required documents that are still drafts; production refuses to start with one (§2). */
export function legalDraftSignupDocuments(legal) {
  return requiredDocuments(legal).filter((document) => document.status === "draft");
}

/**
 * The production start guard.
 *
 * A draft is editable, so its hash is not proof of anything. A production installation
 * that asks people to accept one would collect acceptances of a text that can change
 * under them. `REMO_LEGAL_ALLOW_DRAFTS=1` is the documented exception for a test stand.
 */
export function assertLegalDrafts(legal, env = process.env) {
  // A production installation with the stand's permission is a configuration error, and
  // it is caught even when every document happens to be published: the flag itself is
  // the mistake, and the next draft must not become the moment it is noticed (ADR-261).
  assertLegalDraftsFlag(env);
  if (env.NODE_ENV !== "production") return;
  if (legalDraftsAllowed(env)) return;
  const drafts = legalDraftSignupDocuments(legal);
  if (!drafts.length) return;
  throw new Error(
    `[legal] required document(s) still drafts: ${drafts
      .map((document) => `${document.zone}/${document.doc}`)
      .join(", ")}; publish them, or set REMO_STAGE=1 and REMO_LEGAL_ALLOW_DRAFTS=1 on a test stand`,
  );
}

/**
 * Whether this installation may keep an address digest, and for how long.
 *
 * The defaults follow the zones: the EU installation stores none, the Russian one keeps
 * it for 1095 days. A value that is not `0` or `1`, or retention that is not a whole
 * number of days, stops the start instead of silently choosing a policy. `0` days means
 * "do not store" in both zones: an enabled switch cannot outvote an explicit zero.
 */
export function legalIpPolicy(env = process.env, zone = "none") {
  const rawStore = String(env.REMO_LEGAL_STORE_IP ?? "").trim();
  if (rawStore !== "" && rawStore !== "0" && rawStore !== "1") {
    throw new Error("[legal] REMO_LEGAL_STORE_IP must be 0 or 1");
  }
  const wanted = rawStore === "" ? zone === "ru" : rawStore === "1";
  const rawDays = String(env.REMO_LEGAL_IP_RETENTION_DAYS ?? "").trim();
  let retentionDays;
  if (rawDays === "") {
    retentionDays = zone === "ru" ? DEFAULT_RU_IP_RETENTION_DAYS : 0;
  } else {
    if (!/^\d+$/.test(rawDays)) {
      throw new Error("[legal] REMO_LEGAL_IP_RETENTION_DAYS must be a whole number of days");
    }
    retentionDays = Number(rawDays);
  }
  return { storeIp: wanted && retentionDays > 0, retentionDays };
}

/**
 * The pass that clears address digests older than the retention period.
 *
 * A row is the proof of an acceptance and stays; only `ip_hash` becomes null. The pass is
 * skipped when the installation stores no address (`retentionDays: 0` or `storeIp: false`),
 * so the EU default does not run a write against every row for nothing.
 */
export function createLegalIpRetention({
  store,
  policy,
  log = console,
  intervalMs = LEGAL_IP_RETENTION_INTERVAL_MS,
  now = () => new Date(),
}) {
  let timer = null;

  async function runOnce() {
    if (!policy?.storeIp || policy.retentionDays <= 0) return 0;
    if (typeof store.clearLegalIpBefore !== "function") return 0;
    const cutoff = new Date(now().getTime() - policy.retentionDays * 86400000);
    const cleared = await store.clearLegalIpBefore(cutoff);
    return Number(cleared ?? 0);
  }

  function start() {
    if (!policy?.storeIp || policy.retentionDays <= 0) return;
    if (typeof store.clearLegalIpBefore !== "function") return;
    timer = setInterval(() => {
      void runOnce().catch((error) => {
        log.error?.("[legal] address retention failed:", error?.message ?? error);
      });
    }, intervalMs);
    timer.unref?.();
  }

  function stop() {
    if (timer) clearInterval(timer);
  }

  return { runOnce, start, stop };
}

/**
 * The policy address an invitation letter may carry (§6).
 *
 * The operator's own cookie-policy address wins because they chose it. Without one, the
 * zone's privacy document is the right page, and the branded site apex is the last
 * fallback for an installation that has not published a registry. The `none` zone with
 * neither a document nor a configured address has nothing to link.
 */
export function legalPolicyUrl({ legal, env = process.env } = {}) {
  // The cookie address is published only together with a zone (ADR-255 §3); an
  // installation that chose `none` keeps the invitation letter it had before.
  if (legal?.zone && legal.zone !== "none") {
    const configured = cookiePolicyUrl(env?.REMO_COOKIE_POLICY_URL);
    if (configured) return configured;
  }
  const privacy = (legal?.documents ?? []).find((document) => document.doc === "privacy");
  if (privacy?.url) return privacy.url;
  if (legal?.zone === "ru") return `https://${BRAND.domains.siteRu}/legal/privacy`;
  if (legal?.zone === "eu") return `https://${BRAND.domains.site}/legal/privacy`;
  return null;
}

/**
 * The whole legal side of a running service in one call: the registry of this zone, the
 * start guard, the wire shape, the retention pass and the daily notice. Kept here so the
 * composition root names one object instead of repeating five decisions it does not own.
 */
export function createLegalRuntime({
  store,
  env = process.env,
  zone,
  origin,
  log = console,
  mailConfig = null,
  now = () => new Date(),
}) {
  const registry = resolveLegal(env, {
    zone,
    origin: origin ?? (env.REMO_APP_ORIGIN || undefined),
  });
  assertLegalDrafts(registry, env);
  return {
    registry,
    config: legalConfig(registry),
    retention: createLegalIpRetention({ store, policy: registry.ipPolicy, log }),
    notices: createLegalNoticeLoop({ store, legal: registry, mailConfig, env, log, now }),
  };
}
