import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Dialog, IconButton, Link } from "@remo/ui";
import type { NEWS_TYPES } from "@remo/metrics";
import { api } from "./api";
import { countHint } from "./hintCatalog";
import { call } from "./apiCall";
import { boardDirectory, type BoardTile } from "./boardDirectory";
import { useI18n } from "./i18n";
import { useOnceHint } from "./useOnceHint";

type NewsType = (typeof NEWS_TYPES)[number];
interface News {
  id: string; type: NewsType; at: string; roomId?: string; roomTitle?: string; targetId?: string;
  people: { name: string; color: string }[];
  actionKey: "join" | "reply" | "review" | "invite";
}
const storageKey = "remuka.news.dismissed";
function dismissed(): Record<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
    return Object.fromEntries(Object.entries(raw).filter(([, time]) =>
      typeof time === "number" && time > Date.now() - 2 * 86_400_000)) as Record<string, number>;
  } catch { return {}; }
}

export function useHomeNews(userId?: string, orgId?: string) {
  const key = userId && orgId ? userId + ":" + orgId : "";
  const [loaded, setLoaded] = useState<{ key: string; items: News[] }>();
  const [hidden, setHidden] = useState(dismissed);
  useEffect(() => {
    if (!key) return;
    let active = true;
    let running = false;
    const refresh = async () => {
      if (running || document.hidden) return;
      running = true;
      try {
        const { news } = await call<{ news: News[] }>(`/home/news?org=${orgId}`);
        if (active) setLoaded({ key, items: news });
      } catch {
        if (active) setLoaded(undefined);
      } finally { running = false; }
    };
    void refresh();
    const timer = window.setInterval(refresh, 30_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [key, orgId]);
  const hide = (id: string) => {
    const next = { ...hidden, ...dismissed(), [key + ":" + id]: Date.now() };
    setHidden(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* session-only */ }
  };
  const ready = loaded?.key === key;
  return { items: ready ? loaded.items.filter(row => !hidden[key + ":" + row.id]) : [], ready, hide };
}

export function HomeQuiet({ ready, canCreate }: { ready: boolean; canCreate: boolean }) {
  const { t } = useI18n();
  const hint = useOnceHint("home.quiet", { active: ready && canCreate });
  return <p className="home-lead">{t(canCreate ? hint.variant.key : "news.quietMember")}</p>;
}

function destination(roomId: string, panel?: string, target?: string) {
  const params = new URLSearchParams({ room: roomId });
  if (panel) params.set("homeAction", panel);
  if (target) params.set("target", target);
  return "/?" + params;
}

export function NewsSummary({ items }: { items: News[] }) {
  const { t } = useI18n();
  const live = items.find(item => item.type === "live");
  const proposal = items.find(item => item.type === "agent");
  const highlights = live && proposal ? [live, proposal] : items.slice(0, 2);
  return <p className="home-lead home-news-lead">{highlights.map(item =>
    t(`news.summary.${item.type}`, {
      room: item.roomTitle || t("board.untitled"), name: item.people[0]?.name ?? "",
    }),
  ).join(" ")}</p>;
}

export function NewsItem({ item, orgId, hide, invite }: {
  item: News; orgId: string; hide: (id: string) => void; invite: () => void;
}) {
  const { t, hints, hintsReady } = useI18n();
  const day = new Date().toLocaleDateString("en-CA");
  const hash = Array.from(item.id + day).reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 0);
  const order = (["b", "a"] as const).filter(key => !hints["news." + item.type]?.some(v => v.key === key && !v.enabled));
  const variant = order[hash % order.length] ?? "a";
  useEffect(() => {
    if (hintsReady) countHint("hint.shown", "news." + item.type, variant);
  }, [hintsReady, item.type, variant]);
  const labels = {
    name: item.people[0]?.name ?? "", room: item.roomTitle || t("board.untitled"),
    others: item.people.length > 1 ? t("news.others", { count: item.people.length - 1 }) : "",
  };
  const href = item.roomId ? destination(item.roomId, item.type === "live" ? undefined : item.type, item.targetId) : null;
  const track = () => {
    if (hintsReady) countHint("hint.acted", "news." + item.type, variant);
    void call("/home/news/click?org=" + orgId, { method: "POST", body: { type: item.type }, keepalive: true }).catch(() => {});
  };
  return <article className="home-news-card" data-news-type={item.type}>
    <div className="home-news-heading">
      <Badge tone={item.type === "live" ? "success" : item.type === "agent" ? "neutral" : "warning"}>{t(`news.kind.${item.type}`)}</Badge>
      <IconButton icon="close" label={t("news.dismiss")} onClick={() => hide(item.id)} />
    </div>
    {item.people.length > 0 && <div className="home-news-people" aria-hidden="true">
      {item.people.slice(0, 3).map((person, i) => <span key={i} style={{ backgroundColor: person.color }}>{person.name.slice(0, 1)}</span>)}
    </div>}
    <span>{t(`news.${item.type}.${variant}`, labels)}</span>
    {href ? <Link href={href} onClick={track}>{t(`news.action.${item.actionKey}`)}</Link> :
      <Button variant="ghost" size="compact" onClick={() => { track(); invite(); }}>{t("news.action.invite")}</Button>}
  </article>;
}

export function InviteNewsRoom({ slug, onClose }: { slug: string; onClose: () => void }) {
  const { t } = useI18n();
  const [page, setPage] = useState(1);
  const [rooms, setRooms] = useState<BoardTile[]>([]);
  const [more, setMore] = useState(false);
  const [status, setStatus] = useState<"loading" | "done" | "failed">("loading");
  const load = useCallback(async () => {
    const dir = await boardDirectory({ org: slug, page, limit: 12 });
    const permitted = await Promise.all(dir.boards.map(async b =>
      (await api.access(b.id).catch(() => null))?.access.capabilities.includes("board.share") ? b : null));
    return { rooms: permitted.filter((b): b is BoardTile => Boolean(b)), more: page * dir.pageSize < dir.total };
  }, [slug, page]);
  useEffect(() => {
    let active = true;
    setStatus("loading");
    void load().then(result => {
      if (active) { setRooms(result.rooms); setMore(result.more); setStatus("done"); }
    }).catch(() => { if (active) setStatus("failed"); });
    return () => { active = false; };
  }, [load]);
  return <Dialog title={t("news.chooseRoom")} onClose={onClose}>
    {status !== "done" ? <p>{t(status === "loading" ? "home.loading" : "home.failed")}</p> : <>
      {rooms.length ? <ul>{rooms.map(b => <li key={b.id}><Link href={destination(b.id, "invite")}>{b.title || t("board.untitled")}</Link></li>)}</ul> : <p>{t("news.noRoom")}</p>}
      {page > 1 && <Button onClick={() => setPage(n => n - 1)}>{t("home.previousPage")}</Button>}
      {more && <Button onClick={() => setPage(n => n + 1)}>{t("home.nextPage")}</Button>}
    </>}
  </Dialog>;
}
