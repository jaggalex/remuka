/**
 * The signed-in side of the legal journal: what this person accepted, accepting a new
 * revision, and withdrawing a separate consent (ADR-256 §4–§6).
 *
 * Three routes, one owner:
 *
 *   `GET  /account/legal`          the state of every document of this zone for this person
 *   `POST /account/legal`          accept one or more current revisions
 *   `POST /account/legal/withdraw` withdraw a document the registry marks `withdrawable`
 *
 * The registry decides what exists and which revision is current; the request only says
 * which of those the person read. A request can neither name another zone's document nor
 * record a revision the installation never published. Values written to the journal are
 * copied from the registry, never from the body.
 *
 * The re-acceptance window is computed here, not in the browser: a document with
 * `reaccept: true` whose current revision is not the person's latest accepted one is
 * pending. An account that never accepted anything is pending on every such document,
 * which is how accounts created before the release meet §5 at their first sign-in.
 */
import { hashedClientIp, requestUserAgent } from "./ip-hash.mjs";
import {
  acceptanceProblem,
  legalDocumentById,
  legalIpPolicy,
  pendingAcceptanceDocuments,
} from "./legal.mjs";
import { fail, json, readBody } from "./iam-http.mjs";

/** The wire shape of one document's state for this person. */
function documentState(document, row) {
  const accepted = Boolean(
    row && row.event !== "withdraw" && row.zone === document.zone &&
    Number(row.version) === document.version && row.sha256 === document.sha256,
  );
  return {
    doc: document.doc,
    zone: document.zone,
    version: document.version,
    sha256: document.sha256,
    effective: document.effective ?? null,
    required: document.required,
    reaccept: document.reaccept,
    status: document.status,
    withdrawable: document.withdrawable === true,
    url: document.url,
    accepted,
    acceptedAt: row?.accepted_at ?? null,
    acceptedVersion: row?.version ?? null,
    withdrawnAt: row?.event === "withdraw" ? row.accepted_at : null,
  };
}

/** The current state plus the documents the blocking window must ask for. */
function accountLegalView(legal, rows) {
  const latest = new Map((rows ?? []).map((row) => [row.doc, row]));
  const pending = pendingAcceptanceDocuments(legal, rows);
  const pendingDocs = new Set(pending.map((document) => document.doc));
  return {
    zone: legal?.zone ?? "none",
    documents: (legal?.documents ?? []).map((document) => ({
      ...documentState(document, latest.get(document.doc)),
      pending: pendingDocs.has(document.doc),
    })),
    pending: pending.map((document) => document.doc),
  };
}

/** A body of acceptances, or the reason it cannot be used. */
function readAcceptances(body) {
  const raw = body?.acceptances;
  if (!Array.isArray(raw) || raw.length === 0) return { error: "LEGAL_ACCEPTANCE_REQUIRED" };
  const seen = new Set();
  const items = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return { error: "LEGAL_ACCEPTANCE_REQUIRED" };
    }
    if (typeof item.doc !== "string" || !item.doc) return { error: "LEGAL_ACCEPTANCE_REQUIRED" };
    if (seen.has(item.doc)) return { error: "LEGAL_DOCUMENT_DUPLICATED" };
    seen.add(item.doc);
    items.push({ doc: item.doc, version: Number(item.version), sha256: String(item.sha256 ?? "").toLowerCase() });
  }
  return { items };
}

export async function handleAccountLegalRoutes(ctx) {
  const { request, response, url, method, store, session, user, legal, log = console } = ctx;

  if (url.pathname === "/account/legal" && method === "GET") {
    if (!session || !user) return fail(response, 401, "AUTH_REQUIRED", "sign in first"), true;
    const rows = await store.latestLegalAcceptances(user.id);
    json(response, 200, accountLegalView(legal, rows));
    return true;
  }

  if (url.pathname === "/account/legal" && method === "POST") {
    if (!session || !user) return fail(response, 401, "AUTH_REQUIRED", "sign in first"), true;
    const body = await readBody(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return fail(response, 400, "BAD_JSON", "malformed request"), true;
    }
    const parsed = readAcceptances(body);
    if (parsed.error) {
      return fail(response, 400, parsed.error, "name the documents you accept"), true;
    }

    // Every submitted document must be one this zone publishes at the revision named.
    // The same answer as registration, so a client that refreshed `/config` can simply
    // ask again; an unknown document is a refusal, not an error the person can fix.
    const documents = [];
    for (const item of parsed.items) {
      const document = legalDocumentById(legal, item.doc);
      if (!document) {
        return fail(response, 422, "LEGAL_DOCUMENT_UNKNOWN", "this installation has no such document"), true;
      }
      documents.push(document);
    }
    const problem = acceptanceProblem(documents, parsed.items);
    if (problem) {
      const { code, ...details } = problem;
      return json(response, 400, { error: code, ...details }), true;
    }

    // Values come from the registry, not the request.
    const rows = documents.map(({ zone, doc, version, sha256 }) => ({
      zone,
      doc,
      version,
      sha256,
      event: "accept",
    }));
    const policy = legal?.ipPolicy ?? legalIpPolicy(process.env, legal?.zone ?? "none");
    await store.recordLegalAcceptances({
      userId: user.id,
      rows,
      ipHash: policy.storeIp ? hashedClientIp(request) : null,
      userAgent: requestUserAgent(request),
      requestId: request.headers["x-request-id"] ?? null,
      sessionId: session.sessionId ?? null,
    });
    const latest = await store.latestLegalAcceptances(user.id);
    json(response, 200, accountLegalView(legal, latest), {});
    return true;
  }

  if (url.pathname === "/account/legal/withdraw" && method === "POST") {
    if (!session || !user) return fail(response, 401, "AUTH_REQUIRED", "sign in first"), true;
    const body = await readBody(request);
    if (!body || typeof body !== "object") {
      return fail(response, 400, "BAD_JSON", "malformed request"), true;
    }
    const doc = typeof body.doc === "string" ? body.doc : "";
    const document = legalDocumentById(legal, doc);
    if (!document) {
      return fail(response, 404, "LEGAL_DOCUMENT_UNKNOWN", "this installation has no such document"), true;
    }
    // A contract-based document has no separate consent to withdraw; the index says so,
    // not the browser and not this module (§6).
    if (document.withdrawable !== true) {
      return fail(response, 403, "LEGAL_WITHDRAW_NOT_ALLOWED", "this document cannot be withdrawn"), true;
    }

    const existing = (await store.latestLegalAcceptances(user.id)).find((row) => row.doc === doc);
    if (!existing || existing.event === "withdraw") {
      return json(response, 200, {
        changed: false,
        ...accountLegalView(legal, await store.latestLegalAcceptances(user.id)),
      }), true;
    }

    // A withdrawal is proof of the act, so it carries the revision it withdraws.
    const policy = legal?.ipPolicy ?? legalIpPolicy(process.env, legal?.zone ?? "none");
    await store.recordLegalAcceptances({
      userId: user.id,
      rows: [
        {
          zone: document.zone,
          doc: document.doc,
          version: Number(existing.version),
          sha256: existing.sha256,
          event: "withdraw",
        },
      ],
      ipHash: policy.storeIp ? hashedClientIp(request) : null,
      userAgent: requestUserAgent(request),
      requestId: request.headers["x-request-id"] ?? null,
      sessionId: session.sessionId ?? null,
    });
    const latest = await store.latestLegalAcceptances(user.id);
    log.info?.(`[legal] ${user.id} withdrew ${document.zone}/${document.doc}`);
    json(response, 200, { changed: true, ...accountLegalView(legal, latest) });
    return true;
  }

  return false;
}
