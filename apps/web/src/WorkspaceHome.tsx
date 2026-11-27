import { PlanNotice } from "./PlanNotice";
import { planLimitFrom, type PlanLimitNotice } from "./apiBilling";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BrandMark, Button, Icon, Input, Select } from "@remo/ui";
import { brandName } from "@remo/brand";
import type { TemplateKey } from "@remo/model";
import { api, type OrgSummary } from "./api";
import {
  boardDirectory,
  type BoardDirectoryPage,
  type BoardTile,
} from "./boardDirectory";
import { AuthDialog } from "./AuthDialog";
import { BoardDeleteDialog } from "./BoardDeleteDialog";
import { ConsentLink } from "./ConsentProvider";
import { HomeMail, resetVerificationBanner } from "./HomeMail";
import { actedOnHint } from "./hintCatalog";
import { HomeQuiet, InviteNewsRoom, NewsItem, NewsSummary, useHomeNews } from "./HomeNews";
import { HomeRooms, type HomeSort } from "./HomeRooms";
import { HomeTemplates } from "./HomeTemplates";
import { greetingKey } from "./homeGreeting";
import { InviteDialog } from "./InviteDialog";
import { NewBoardDialog } from "./NewBoardDialog";
import { OrganisationEntry } from "./OrganisationPage";
import { SessionsDialog } from "./SessionsDialog";
import { AccountDeletionBanner } from "./AccountDeletion";
import { BillingStatusNotice } from "./BillingStatusNotice";
import type { DeletionSchedule } from "./accountDeletionApi";
import { AccountMenu } from "./topbar/AccountMenu";
import { InterfaceToggles } from "./topbar/InterfaceToggles";
import { loadIdentity, type Identity } from "./identity";
import { clearMailParams, showForgot, type MailLinks } from "./mailLinks";
import { useBoardAccess } from "./useBoardAccess";
import { useAccountPreferences } from "./useAccountPreferences";
import { useCursorIdentity } from "./useCursorIdentity";
import { useI18n } from "./i18n";
import { useTheme } from "./useTheme";
import { useCalmMotion } from "./useMotion";

type Sort = HomeSort;
const PAGE_SIZE = 24;

function readSort(value: string | null): Sort {
  return value === "created" || value === "name" || value === "author" ? value : "updated";
}

/**
 * The organisation home (ADR-168), rebuilt as the team home of the mockup App-Home.
 *
 * The greeting, "Now in the team", "Start from ready-made" and "Team rooms" are the four
 * blocks of the mockup. The directory (search, sort, pages, the tile menu) is still one
 * mechanism and still appears only when there is more than one page or a filter (ADR-197);
 * its search lives in the header, where the mockup puts it. Team news is scoped to
 * the active account and organisation and exists only when there is something to show.
 */
export function WorkspaceHome({
  inviteToken,
  mail,
}: {
  inviteToken: string | null;
  mail: MailLinks;
}) {
  const { t, lang, setLang, productName } = useI18n();
  const { theme, resolved, setTheme } = useTheme();
  const { calm, setCalm } = useCalmMotion();
  const { me, setMe, orgs, refreshOrgs, sessionReady } = useBoardAccess(null);
  useAccountPreferences({ me, theme, setTheme, lang, setLang, calm, setCalm });
  const [identity, setIdentity] = useState<Identity>(() => loadIdentity());
  const { renameSelf, forgetAccountName } = useCursorIdentity({
    accountName: me?.name,
    setIdentity,
  });

  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const [query, setQuery] = useState(() => params.get("q") ?? "");
  const [sort, setSort] = useState<Sort>(() => readSort(params.get("sort")));
  const [dir, setDir] = useState<"asc" | "desc">(() =>
    params.get("dir") === "asc" ? "asc" : "desc",
  );
  const [page, setPage] = useState(() => Math.max(Number(params.get("page") ?? 1), 1));
  const allRooms = location.pathname === "/rooms";
  const [restoreLimit, setRestoreLimit] = useState<PlanLimitNotice | null>(null);
  const [trash, setTrash] = useState(() => params.get("trash") === "1");
  const [data, setData] = useState<BoardDirectoryPage | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [accountOpen, setAccountOpen] = useState(false);
  // `?billing=1` comes from billing mail: open the organisation screen on its plan tab.
  const [orgOpen, setOrgOpen] = useState(() => new URLSearchParams(window.location.search).has("billing"));
  const [orgTab, setOrgTab] = useState<"people" | "billing">(
    () => (new URLSearchParams(window.location.search).has("billing") ? "billing" : "people"),
  );
  /** The organisation the dialog was opened for, when it is not the one being viewed. */
  const [orgTargetId, setOrgTargetId] = useState<string | null>(null);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  /** Set only when this screen asked for the deletion; the link in the letter is the rest. */
  const [deletion, setDeletion] = useState<DeletionSchedule | null>(null);
  // `?signin=1` is the way back from the registration page (SignUpScreen).
  const [authOpen, setAuthOpen] = useState(() => params.get("signin") === "1");
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [forgotOpen, setForgotOpen] = useState(mail.forgot && !mail.resetToken);
  const [creating, setCreating] = useState(false);
  const [templatePreset, setTemplatePreset] = useState<"empty" | TemplateKey>("empty");
  const startNew = (template: "empty" | TemplateKey = "empty") => {
    actedOnHint("home.quiet");
    setTemplatePreset(template);
    setCreating(true);
  };
  const openOrg = (tab: "people" | "billing" = "people", orgId: string | null = null) => {
    setOrgTargetId(orgId);
    setOrgTab(tab);
    setOrgOpen(true);
  };
  const [pendingDelete, setPendingDelete] = useState<BoardTile | null>(null);
  const [emojiBoard, setEmojiBoard] = useState<string | null>(null);

  const requestedSlug = params.get("org");
  const team = params.get("team") ?? undefined;
  const activeOrg: OrgSummary | null =
    orgs.find((org) => org.slug === requestedSlug) ??
    orgs.find((org) => org.kind === "personal") ??
    orgs[0] ??
    null;

  const news = useHomeNews(me?.id, activeOrg?.id);
  const [choosingRoom, setChoosingRoom] = useState(false);

  // The address always names the organisation on screen. A missing or stale `org` is
  // replaced without a history entry: it is a repair, not a navigation step.
  useEffect(() => {
    if (!activeOrg || requestedSlug === activeOrg.slug) return;
    const next = new URLSearchParams(window.location.search);
    next.set("org", activeOrg.slug);
    window.history.replaceState(null, "", `${window.location.pathname}?${next.toString()}`);
  }, [activeOrg, requestedSlug]);

  const requestNumber = useRef(0);
  const load = useCallback(async () => {
    const number = ++requestNumber.current;
    if (!me || !activeOrg) {
      setData(null);
      setStatus("idle");
      return;
    }
    setStatus("loading");
    setError(null);
    try {
      const result = await boardDirectory({
        org: activeOrg.slug,
        team,
        q: query.trim() || undefined,
        sort,
        dir,
        page,
        limit: PAGE_SIZE,
        trash,
      });
      if (number !== requestNumber.current) return;
      setData(result);
      setStatus("idle");
      const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));
      if (page > totalPages) setPage(totalPages);
    } catch (failure) {
      if (number !== requestNumber.current) return;
      setStatus("error");
      setError(failure instanceof Error ? failure.message : t("home.failed"));
    }
  }, [activeOrg, dir, me, page, query, sort, t, team, trash]);

  useEffect(() => {
    if (!me || !activeOrg) return;
    const timer = window.setTimeout(() => void load(), query.trim() ? 200 : 0);
    const refresh = () => { if (!document.hidden) void load(); };
    const interval = window.setInterval(refresh, 60_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      ++requestNumber.current;
      window.clearTimeout(timer);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load, me, activeOrg, query, reloadKey]);

  // Search, sort and page are shareable: the address is the state (ADR-168).
  useEffect(() => {
    if (!activeOrg) return;
    const next = new URLSearchParams(window.location.search);
    next.delete("room");
    next.set("org", activeOrg.slug);
    if (query.trim()) next.set("q", query.trim());
    else next.delete("q");
    if (sort === "updated") next.delete("sort");
    else next.set("sort", sort);
    if (dir === "asc") next.set("dir", "asc");
    else next.delete("dir");
    if (page > 1) next.set("page", String(page));
    else next.delete("page");
    if (trash) next.set("trash", "1");
    else next.delete("trash");
    window.history.replaceState(null, "", `${window.location.pathname}?${next.toString()}`);
  }, [activeOrg, dir, page, query, sort, trash]);

  const total = data?.total ?? 0;
  const pageSize = data?.pageSize ?? PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  // ADR-197: the directory appears only when there is more than one page to direct.
  const directory = allRooms || total > PAGE_SIZE || Boolean(query.trim()) || trash || page > 1;

  const switchOrg = (slug: string) => {
    // A different organisation is a different context: no board, no stale filters.
    window.location.assign(`${window.location.pathname}?org=${encodeURIComponent(slug)}`);
  };

  const openBoard = (board: { id: string }) => {
    window.location.assign(`${window.location.pathname}?room=${encodeURIComponent(board.id)}`);
  };

  const openInvitationTarget = async ({ orgId, boardId }: { orgId: string; boardId: string | null }) => {
    const next = new URLSearchParams();
    if (boardId) {
      next.set("room", boardId);
    } else {
      const result = await api.orgs().catch(() => null);
      const org = result?.orgs.find((item) => item.id === orgId);
      if (org) next.set("org", org.slug);
    }
    if (params.has("lang")) next.set("lang", lang);
    window.location.replace(next.size ? `/?${next}` : "/");
  };

  const createdBoard = (boardId: string, template: string, title: string) => {
    const next = new URLSearchParams({ room: boardId });
    if (template) next.set("template", template);
    if (title) next.set("name", title);
    window.location.assign(`/?${next.toString()}`);
  };

  const setIcon = (board: BoardTile, icon: string) => {
    setData((current) => current && {
      ...current,
      boards: current.boards.map((row) => row.id === board.id ? { ...row, icon } : row),
    });
  };

  const restoreBoard = async (board: BoardTile) => {
    setRestoreLimit(null);
    try {
      await api.restoreBoard(board.id);
      setReloadKey((value) => value + 1);
    } catch (failure) {
      const limit = planLimitFrom(failure);
      if (limit) { setRestoreLimit(limit); return; }
      setError(failure instanceof Error ? failure.message : t("home.failed"));
    }
  };

  const removeBoard = async (board: BoardTile) => {
    try {
      await api.deleteBoard(board.id);
      setPendingDelete(null);
      setReloadKey((value) => value + 1);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("home.failed"));
    }
  };

  const duplicateBoard = async (board: BoardTile) => {
    try {
      const copy = await api.duplicateBoard(board.id);
      openBoard(copy.board);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("home.failed"));
    }
  };

  const signOut = async () => {
    try {
      await api.logout();
    } catch {
      // The local state is still dropped: a failed request must not keep the face.
    }
    setMe(null);
    forgetAccountName();
    setAccountOpen(false);
    setOrgOpen(false);
    await refreshOrgs();
    setData(null);
    setStatus("idle");
  };

  // Password recovery is a home flow: the sign-in dialog hands over to it and the address
  // follows (`?forgot=1`), so the form survives a reload and can be linked from a letter.
  const openForgot = () => {
    setAuthOpen(false);
    setAuthNotice(null);
    setForgotOpen(true);
    showForgot();
  };

  const closeForgot = () => {
    setForgotOpen(false);
    clearMailParams();
  };

  const openMailLogin = (notice: string) => {
    setAuthNotice(notice);
    setAuthOpen(true);
  };

  const closeAuth = () => {
    setAuthOpen(false);
    setAuthNotice(null);
    const next = new URLSearchParams(window.location.search);
    if (next.has("signin")) {
      next.delete("signin");
      window.history.replaceState(null, "", `${window.location.pathname}?${next.toString()}`);
    }
  };

  const mailVerified = useCallback(() => {
    setMe((current) => (current ? { ...current, emailVerified: true } : current));
  }, [setMe]);

  const boardTitle = (board: BoardTile) => board.title || t("board.untitled");
  const displayName = me?.name || identity.name;
  const canCreate = Boolean(activeOrg?.capabilities?.includes("board.create"));
  const greeting = t(greetingKey(new Date().getHours()));

  return (
    <div className="home">
      <AccountDeletionBanner schedule={deletion} onCancelled={() => setDeletion(null)} />
      <BillingStatusNotice orgId={me ? (activeOrg?.id ?? null) : null} onOpenBilling={() => { setOrgTab("billing"); setOrgTargetId(null); setOrgOpen(true); }} />
      <header className="home-topbar">
        <div className="home-topbar-inner">
        <a className="home-brand" href="/" aria-label={t("boards.title")}>
          <BrandMark className="home-mark" size={30} wordmark={brandName({ locale: lang, productName })} />
        </a>

        <div className="home-context">
          {/* A quiet switcher, and only when there is somewhere to switch to (ADR-197). */}
          {orgs.length > 1 && activeOrg ? (
            <Select
              size="compact"
              aria-label={t("boards.org")}
              value={activeOrg.slug}
              options={orgs.map((org) => ({
                value: org.slug,
                label: `${org.kind === "personal" ? `${t("org.personal")} · ` : ""}${org.name}`,
              }))}
              onChange={(event) => switchOrg(event.currentTarget.value)}
            />
          ) : activeOrg ? (
            <span className="home-org-chip">
              <span className="home-org-initial" aria-hidden="true">
                {activeOrg.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="home-org-name">{activeOrg.name}</span>
              {activeOrg.kind === "personal" && (
                <span className="org-badge personal">{t("org.personal")}</span>
              )}
            </span>
          ) : null}
        </div>

        {me && activeOrg && (
          <Input
            type="search"
            className="home-search"
            aria-label={t("home.search")}
            placeholder={t("home.searchPlaceholder")}
            value={query}
            onChange={(event) => {
              setQuery(event.currentTarget.value);
              setPage(1);
            }}
          />
        )}

        <nav className="home-account" aria-label={t("boards.title")}>
          <a className="home-help" href={`/help/${lang}`}>
            {t("help.title")}
          </a>
          <AccountMenu
            open={accountOpen}
            onOpen={setAccountOpen}
            name={me?.name ?? identity.name}
            handle={me?.handle ?? ""}
            self={undefined}
            color={identity.color}
            signedIn={Boolean(me)}
            emailVerified={me?.emailVerified}
            roleLine={null}
            identityName={identity.name}
            onRenameSelf={renameSelf}
            onOrg={() => {
              setAccountOpen(false);
              openOrg();
            }}
            onSessions={() => {
              setAccountOpen(false);
              setSessionsOpen(true);
            }}
            onAllRooms={() => location.assign("/rooms" + location.search)}
            theme={theme} setTheme={setTheme} calm={calm} setCalm={setCalm}
            lang={lang} setLang={setLang} withView={false}
            onDeleteScheduled={(schedule) => {
              setDeletion(schedule);
              setMe(null);
            }}
            onDeleteCancelled={() => setDeletion(null)}
            onSignIn={() => {
              setAccountOpen(false);
              setAuthOpen(true);
            }}
            onSignOut={() => void signOut()}
          />
          <InterfaceToggles theme={resolved} onTheme={setTheme} />
        </nav>
        </div>
      </header>

      <HomeMail
        me={me}
        links={mail}
        forgotOpen={forgotOpen}
        onForgotClose={closeForgot}
        onNeedLink={openForgot}
        onVerified={mailVerified}
        onOpenLogin={openMailLogin}
      />

      {!sessionReady ? (
        <p className="home-state">{t("home.loading")}</p>
      ) : !me ? (
        <section className="home-empty" role="region" aria-label={t("home.signInTitle")}>
          <Icon name="boards" size={36} />
          <h1>{t("home.signInTitle")}</h1>
          <p className="muted">{t("home.signInBody")}</p>
          <Button variant="primary" onClick={() => setAuthOpen(true)}>
            {t("home.signInAction")}
          </Button>
        </section>
      ) : !activeOrg ? (
        <section className="home-empty">
          <Icon name="building" size={36} />
          <h1>{t("org.noOrg")}</h1>
          <p className="muted">{t("home.noOrg")}</p>
          <Button variant="primary" onClick={() => openOrg()}>
            {t("org.newOrg")}
          </Button>
        </section>
      ) : (
        <main className="home-content">
          {allRooms ? <header className="org-page-heading"><div><a href={"/?org=" + encodeURIComponent(activeOrg.slug)}>{activeOrg.name}</a><h1>{t("board.allBoards")}</h1></div>
            {canCreate && <Button variant="primary" onClick={() => startNew()}>{t("boards.new")}</Button>}</header> : <section className="home-hero">
            <div className="home-hero-text">
              <h1>
                {greeting}{" "}
                <span className="home-name">
                  <svg
                    className="home-marker"
                    viewBox="0 0 300 30"
                    preserveAspectRatio="none"
                    aria-hidden="true"
                  >
                    <path d="M4 20 C 60 6, 140 4, 296 14 L 294 26 C 170 18, 80 20, 6 28 Z" />
                  </svg>
                  <span className="home-name-text">{displayName}</span>
                </span>
              </h1>
              {news.items.length > 0 ? <NewsSummary items={news.items} /> :
                <HomeQuiet ready={news.ready} canCreate={canCreate} />}
            </div>
            <Button
              variant="primary"
              icon="plus"
              className="home-new"
              onClick={() => startNew()}
              disabled={!canCreate}
            >
              {t("boards.new")}
            </Button>
          </section>}

          {!allRooms && news.ready && <section className="home-now" aria-labelledby="home-now-title">
            <h2 id="home-now-title">{t(news.items.length ? "home.nowTitle" : "home.nowQuiet")}</h2>
            {news.items.length > 0 && <div className="home-news-grid">{news.items.map(item =>
              <NewsItem key={item.id} item={item} orgId={activeOrg.id} hide={news.hide} invite={() => setChoosingRoom(true)} />
            )}</div>}
          </section>}
          {choosingRoom && <InviteNewsRoom slug={activeOrg.slug} onClose={() => setChoosingRoom(false)} />}

          {!allRooms && <section className="home-start" aria-labelledby="home-start-title">
            <h2 id="home-start-title">{t("home.startTitle")}</h2>
            <HomeTemplates disabled={!canCreate} onStart={(template) => startNew(template)} />
          </section>}

          {team && <Button variant="ghost" onClick={() => switchOrg(activeOrg.slug)}>{t("board.allBoards")}</Button>}
          {restoreLimit && <PlanNotice orgId={activeOrg.id} notice={restoreLimit} onDismiss={() => setRestoreLimit(null)} onSeePlans={() => openOrg("billing", activeOrg.id)} />}
          <HomeRooms
            data={data}
            status={status}
            error={error}
            directory={directory}
            query={query}
            sort={sort}
            dir={dir}
            page={page}
            trash={trash}
            totalPages={totalPages}
            lang={lang}
            canCreate={canCreate}
            emojiBoard={emojiBoard}
            boardTitle={boardTitle}
            onSort={(value) => {
              setSort(value);
              setPage(1);
            }}
            onDir={() => {
              setDir((value) => (value === "asc" ? "desc" : "asc"));
              setPage(1);
            }}
            onPage={setPage}
            onTrash={() => {
              setTrash(true);
              setPage(1);
              setQuery("");
            }}
            onBoards={() => {
              setTrash(false);
              setPage(1);
            }}
            onOpen={openBoard}
            onRestore={(board) => void restoreBoard(board)}
            onDuplicate={(board) => void duplicateBoard(board)}
            onDelete={setPendingDelete}
            onEmoji={setEmojiBoard}
            onIcon={setIcon}
            onNew={() => startNew()}
            onRetry={() => setReloadKey((value) => value + 1)}
          />
        </main>
      )}

      {/* §6.3: the one entry to cookie settings and the documents; it is here before
          sign-in too, so the signed-out panel must not repeat it (`spec/cookies.md` §6.3). */}
      <footer className="home-footer">
        <ConsentLink />
      </footer>

      <NewBoardDialog
        open={creating}
        orgs={orgs}
        defaultOrgId={activeOrg?.id ?? null}
        initialTemplate={templatePreset}
        onOpenBilling={(orgId) => {
          setCreating(false);
          openOrg("billing", orgId);
        }}
        onClose={() => setCreating(false)}
        onCreated={createdBoard}
      />

      {pendingDelete && (
        <BoardDeleteDialog
          title={boardTitle(pendingDelete)}
          objects={pendingDelete.widgets}
          linkEnabled={pendingDelete.visibility === "link"}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => void removeBoard(pendingDelete)}
        />
      )}

      {me && (
        <OrganisationEntry
          open={orgOpen}
          me={me}
          initialOrgId={orgTargetId ?? activeOrg?.id ?? null}
          initialTab={orgTab}
          onOrgsChanged={refreshOrgs}
          onClose={() => {
            setOrgOpen(false);
            setOrgTargetId(null);
          }}
          onSignedOut={() => void signOut()}
        />
      )}

      <SessionsDialog
        open={sessionsOpen}
        onClose={() => setSessionsOpen(false)}
        onCurrentRevoked={() => void signOut()}
      />

      {inviteToken && sessionReady && !authOpen && (
        <InviteDialog
          token={inviteToken}
          signedIn={Boolean(me)}
          onSignIn={() => setAuthOpen(true)}
          onDone={openInvitationTarget}
        />
      )}
      <AuthDialog
        open={authOpen}
        onClose={closeAuth}
        onForgot={openForgot}
        notice={authNotice}
        onSignedIn={(user) => {
          resetVerificationBanner(user.id);
          setMe(user);
          setAuthNotice(null);
          closeForgot();
          void refreshOrgs();
        }}
      />
    </div>
  );
}
