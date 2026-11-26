import { NEWS_TYPES } from "@remo/metrics";
import { effective } from "./iam.mjs";
import { fail, json, readBody, sessionFromRequest } from "./iam-http.mjs";
import { emitMetric } from "./metrics-events.mjs";
import { homeCandidates } from "./pg/home-news.mjs";

const weights = { mention: 5, agent: 4, live: 3, joined: 2 };
const actions = { mention: "reply", agent: "review", live: "join", joined: "invite" };
const hour = 3_600_000;
const colours = ["#c93e0a", "#0f7b6c", "#1a6ad8", "#cc2470", "#2b7f17", "#9a5800"];
const person = (name) => ({
  name,
  color: colours[Array.from(name).reduce((n, letter) => ((n * 31) + letter.codePointAt(0)) >>> 0, 0) % colours.length],
});

/** Cache candidate keys only. The next read still verifies permissions, unread,
 * pending proposals and active sockets, even for two requests a second apart. */
const candidatesByViewer = new Map();

export async function rankHomeNews(rows, presence, allowed, now = Date.now()) {
  const score = (row) => weights[row.type] * (row.involved ? 2 : 1) *
    2 ** (-Math.max(0, now - new Date(row.at).getTime()) / (12 * hour));
  const ranked = rows.filter(row => now - new Date(row.at).getTime() <= 48 * hour)
    .sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id));
  const rooms = new Set();
  const counts = {};
  const result = [];
  for (const row of ranked) {
    if ((counts[row.type] ?? 0) === 2 || rooms.has(row.board_id)) continue;
    if (row.board_id && !await allowed(row.board_id, row.type)) continue;
    const names = row.type === "live" ? presence.get(row.board_id) : row.name ? [row.name] : [];
    if (row.type === "live" && !names?.length) continue;
    result.push({
      id: row.type + ":" + row.id, type: row.type, at: row.at, actionKey: actions[row.type],
      ...(row.board_id ? { roomId: row.board_id, roomTitle: row.title } : {}),
      ...(row.target ? { targetId: row.target } : {}),
      people: names.map(person),
    });
    if (row.board_id) rooms.add(row.board_id);
    counts[row.type] = (counts[row.type] ?? 0) + 1;
    if (result.length === 3) break;
  }
  return result;
}

export async function homeNews(store, orgId, user, membership, presence, now = Date.now(), visited = () => false) {
  const cacheKey = user.id + ":" + orgId;
  const cached = candidatesByViewer.get(cacheKey);
  const hit = cached?.until > now;
  const rows = await homeCandidates(store.pool, { orgId, user, liveIds: [...presence.keys()], cached: hit ? cached.ids : null });
  if (!hit) {
    const ids = { mention: [], agent: [], joined: [] };
    for (const row of rows) ids[row.type]?.push(row.id);
    candidatesByViewer.delete(cacheKey);
    if (rows.length <= 1024) candidatesByViewer.set(cacheKey, { until: now + 30_000, ids });
    if (candidatesByViewer.size > 512) candidatesByViewer.delete(candidatesByViewer.keys().next().value);
  }
  for (const row of rows) if (row.board_id && visited(row.board_id)) row.involved = true;
  const access = new Map();
  const allowed = async (roomId, type) => {
    if (!access.has(roomId)) {
      const facts = await store.accessFacts(roomId, user.id);
      // Home discovery uses a membership grant. Knowing a public URL is a separate entry.
      access.set(roomId, facts && !facts.board.archivedAt && facts.board.orgId === orgId ? effective(facts) : null);
    }
    const decision = access.get(roomId);
    if (!decision?.allowed) return false;
    if (type === "mention") return decision.capabilities.includes("board.comment");
    if (type === "agent") return decision.capabilities.includes("board.edit");
    return true;
  };
  return rankHomeNews(rows.filter(row => row.type !== "joined" || membership.relation === "member"), presence, allowed, now);
}

export async function handleHomeNews({ request, response, url, store, connections }) {
  const clicked = url.pathname === "/home/news/click";
  if (!clicked && url.pathname !== "/home/news") return false;
  if (request.method !== (clicked ? "POST" : "GET")) return fail(response, 405, "METHOD_NOT_ALLOWED", "unsupported method"), true;
  if (!store.pool) return fail(response, 501, "IAM_UNAVAILABLE", "accounts need postgres"), true;
  const session = await sessionFromRequest(request, store);
  if (!session) return fail(response, 401, "AUTH_REQUIRED", "sign in first"), true;
  const orgId = url.searchParams.get("org") ?? "";
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(orgId)) return fail(response, 422, "ORG_REQUIRED", "an organisation id is required"), true;
  await store.withTenant(orgId, async () => {
    const membership = await store.getOrgMembership(orgId, session.user.id);
    const org = await store.pool.query("select 1 from orgs where id=$1 and suspended_at is null", [orgId]);
    if (membership?.state !== "active" || !org.rowCount) return fail(response, 404, "RESOURCE_NOT_AVAILABLE", "not found");
    response.setHeader("Cache-Control", "private, no-store");
    if (clicked) {
      const { type } = await readBody(request);
      if (!NEWS_TYPES.includes(type)) return fail(response, 422, "UNKNOWN_TYPE", "unknown news type");
      emitMetric({ name: "news.clicked", orgId, actorType: "user", actorId: null, sessionId: null, props: { type } });
      return json(response, 202, { ok: true });
    }
    const presence = connections.homePresence(orgId, session.user.id);
    const visited = (boardId) => connections.recentlyVisited(orgId, session.user.id, boardId);
    json(response, 200, { news: await homeNews(store, orgId, session.user, membership, presence, Date.now(), visited) });
  });
  return true;
}
