import { useEffect, useState } from "react";
import type { MutableRefObject } from "react";
import type { Presence, SaveState } from "@remo/doc";
import { Button, ConfirmDialog, Icon, IconButton, Menu, Popover, Tooltip } from "@remo/ui";
import type { SessionUser } from "./api";
import type { FollowState } from "./follow";
import { formatRemaining, TEMPLATE_KEYS, type TemplateKey } from "@remo/model";
import { useI18n } from "./i18n";
import type { Identity } from "./identity";
import type { Theme } from "./useTheme";
import { useMediaQuery } from "./useMediaQuery";
import { TEMPLATE_LABEL_KEY } from "./templateLabels";
import { menuCommands, reactionCommands, type ChromeCommand, type ChromeContext } from "./commands";
import { BoardTitleMenu } from "./topbar/BoardTitleMenu";
import { AccountMenu } from "./topbar/AccountMenu";
import { PeopleMenu } from "./topbar/PeopleMenu";
import { SaveLine } from "./topbar/SaveLine";
import { menuItemsFrom } from "./topbar/registryItems";
import { useMenuFocus } from "./useMenuFocus";
import { SessionsDialog } from "./SessionsDialog";
import { REACTIONS } from "./reactions";

/** Which top-bar surface is open. One at a time: they share the same screen edge. */
type MenuView = "board" | "people" | "run" | "agent" | "templates" | "account" | null;

/**
 * The room's header: eight things, not sixteen (ADR-266 §2).
 *
 * Logo and account open the account menu; the room's name opens its own menu; faces
 * open the people list; Run, Agent, Comments, Invite and Account are the rest. The
 * timer and vote chips are states, not items: they exist only while a session runs
 * and open "Run" at their section. Every menu row comes from the chrome registry
 * (`commands.ts`), so a control that is not in the registry cannot be here.
 */
export interface BoardTopbarProps {
  title: string;
  titleDraft: string | null;
  setTitleDraft: (value: string | null) => void;
  titleCancelled: MutableRefObject<boolean>;
  renameBoard: (value: string) => void;
  /** "Organisation /" before the title; a personal board has no path. */
  orgName: string | null;
  boardId: string;
  /** My effective role in this room, for the people list. */
  role: string | null;
  writeBlocked: boolean;
  readOnly: boolean;
  planFrozen: boolean;
  onOpenBilling: () => void;
  onOpenHome: () => void;
  canShare: boolean;
  copied: boolean;
  copyShareLink: () => void;
  setShareOpen: (value: boolean) => void;
  canExport: boolean;
  canBackup: boolean;
  canImport: boolean;
  canDuplicate: boolean;
  canDelete: boolean;
  canFacilitate: boolean;
  canAskAgents: boolean;
  canUseApps: boolean;
  setSettingsOpen: (value: boolean) => void;
  setExportOpen: (value: boolean) => void;
  onRestore: () => void;
  onDuplicate: () => void;
  onTrash: () => void;
  onReplace: () => void;
  voteRunning: boolean;
  voteHint: string;
  /** Votes cast so far in the open session; zero keeps the number out of the chip. */
  voteTotal: number;
  timerRunning: boolean;
  timerHint: string;
  timerLeft: number;
  setVoteOpen: (value: boolean) => void;
  setTimerOpen: (value: boolean) => void;
  setFollowOpen: (value: boolean) => void;
  setAgentOpen: (value: boolean) => void;
  roomAgent: { name: string; enabled: boolean; status: string | null } | null;
  canAssignAgent: boolean;
  hasRoomAgentHistory: boolean;
  onOpenRoomAgent: () => void;
  onOpenAgentSettings: () => void;
  setAppsOpen: (value: boolean) => void;
  onReact: (emoji: string) => void;
  follow: FollowState;
  toggleFollow: (target: string, label: string) => void;
  myFollowers: number;
  otherPeers: number;
  visiblePresence: Presence[];
  me: SessionUser | null;
  identity: Identity;
  roleLine: string | null;
  renameSelf: (value: string) => void;
  onAccountRenamed: (user: SessionUser) => void;
  theme: Theme;
  setTheme: (value: Theme) => void;
  setAccountOpen: (value: boolean) => void;
  setAuthOpen: (value: boolean) => void;
  onSignOut: () => void;
  saveState: SaveState;
  toggleInspector: () => void;
  setPresentOpen: (value: boolean) => void;
  commentsOpen: boolean;
  setCommentsOpen: (value: boolean) => void;
  commentsUnread: number;
  addTemplate: (key: TemplateKey) => void;
  /** A counter from the empty room's example link: open the template picker. */
  templateRequest: number;
}

export function BoardTopbar(props: BoardTopbarProps) {
  const { t, lang, setLang } = useI18n();
  const narrow = useMediaQuery("(max-width: 899px)");
  const [menu, setMenu] = useState<MenuView>(null);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [renaming, setRenaming] = useState(false);
  // Opening a menu moves focus inside it, so Escape and the arrow keys work; closing
  // returns focus to the trigger (ADR-124).
  const runAnchor = useMenuFocus(menu, "run");
  const agentAnchor = useMenuFocus(menu, "agent");
  const templateAnchor = useMenuFocus(menu, "templates", ".topbar-templates-anchor .rm-popover button");
  const {
    title, titleDraft, setTitleDraft, titleCancelled, renameBoard, orgName, boardId, role,
    writeBlocked, readOnly, planFrozen, onOpenBilling, onOpenHome, canShare, copied,
    copyShareLink, setShareOpen, canExport, canBackup, canImport, canDuplicate, canDelete,
    canFacilitate, canAskAgents, canUseApps, setSettingsOpen, setExportOpen, onRestore,
    onDuplicate, onTrash, onReplace, voteRunning, voteHint, voteTotal, timerRunning,
    timerHint, timerLeft, setVoteOpen, setTimerOpen, setFollowOpen, setAgentOpen,
    roomAgent, canAssignAgent, hasRoomAgentHistory, onOpenRoomAgent, onOpenAgentSettings,
    setAppsOpen, onReact, toggleFollow, myFollowers, visiblePresence, me,
    identity, roleLine, renameSelf, onAccountRenamed, theme, setTheme, setAccountOpen,
    setAuthOpen, onSignOut, saveState, toggleInspector, setPresentOpen, commentsOpen, setCommentsOpen, commentsUnread, addTemplate,
    templateRequest,
  } = props;

  useEffect(() => {
    if (templateRequest > 0) setMenu("templates");
  }, [templateRequest]);

  const self = visiblePresence.find((peer) => peer.self);
  const peers = visiblePresence.filter((peer) => !peer.self);
  const name = me?.name ?? self?.name ?? identity.name;
  const agentVisible = Boolean(roomAgent || canAssignAgent || hasRoomAgentHistory);

  const close = () => setMenu(null);

  const commitTitle = (value: string) => {
    if (titleCancelled.current) {
      titleCancelled.current = false;
      setTitleDraft(null);
    } else {
      renameBoard(value);
    }
    setRenaming(false);
  };

  const templates = TEMPLATE_KEYS.map((key) => ({ key, label: t(TEMPLATE_LABEL_KEY[key]) }));

  /**
   * Handlers by command id. The registry names the action, this map is the only place
   * that knows which panel opens; the menu builder calls `ctx.run(id)`.
   */
  const actions: Record<string, () => void> = {
    "room.rename": () => {
      close();
      setRenaming(true);
    },
    "room.settings": () => {
      close();
      setSettingsOpen(true);
    },
    "room.properties": () => {
      close();
      toggleInspector();
    },
    "room.access": () => {
      close();
      if (canShare) setShareOpen(true);
      else copyShareLink();
    },
    "room.export": () => {
      close();
      setExportOpen(true);
    },
    "room.restore": () => {
      close();
      onRestore();
    },
    "room.duplicate": () => {
      close();
      onDuplicate();
    },
    "room.copyLink": () => {
      close();
      copyShareLink();
    },
    "room.template": () => setMenu("templates"),
    "room.apps": () => {
      close();
      setAppsOpen(true);
    },
    "room.replace": () => {
      close();
      setConfirmReplace(true);
    },
    "room.trash": () => {
      close();
      onTrash();
    },
    "run.timer": () => {
      close();
      setTimerOpen(true);
    },
    "run.vote": () => {
      close();
      setVoteOpen(true);
    },
    "run.presentation": () => {
      close();
      setPresentOpen(true);
    },
    "run.follow": () => {
      close();
      setFollowOpen(true);
    },
    "agent.open": () => {
      close();
      onOpenRoomAgent();
    },
    "agent.ask": () => {
      close();
      setAgentOpen(true);
    },
    "agent.settings": () => {
      close();
      onOpenAgentSettings();
    },
    "invite.open": () => {
      close();
      if (canShare) setShareOpen(true);
      else copyShareLink();
    },
  };
  reactionCommands().forEach((command, index) => {
    actions[command.id] = () => {
      close();
      const reaction = REACTIONS[index];
      if (reaction) onReact(reaction.emoji);
    };
  });

  const ctx: ChromeContext = {
    can: {
      rename: !writeBlocked,
      export: canExport || canBackup,
      import: canImport,
      duplicate: canDuplicate,
      delete: canDelete,
      access: canShare,
      facilitate: canFacilitate,
      agents: agentVisible,
      askAgents: canAskAgents,
      apps: canUseApps,
      signedIn: Boolean(me),
      support: false,
      templates: !writeBlocked,
    },
    run: (id) => actions[id]?.(),
  };

  const roomCommands = menuCommands(["room"], ctx);
  const runCommands = menuCommands(["run"], ctx);
  const agentCommands = menuCommands(["agent"], ctx);
  const isLive = voteRunning || timerRunning;
  const timerDanger = timerRunning && timerLeft <= 10;

  return (
    <>
      <header className={narrow ? "topbar is-narrow" : "topbar"}>
        <button
          type="button"
          className="topbar-mark topbar-wide-only"
          aria-label={t("board.markMenu")}
          aria-haspopup="dialog"
          aria-expanded={menu === "account"}
          onClick={() => setMenu(menu === "account" ? null : "account")}
        >
          <img src="/remuka-mark.svg" alt="" />
        </button>

        <div className="topbar-left">
          <BoardTitleMenu
            title={title}
            path={orgName}
            renaming={renaming}
            onRenaming={setRenaming}
            draft={titleDraft ?? title}
            onDraft={setTitleDraft}
            onCommit={commitTitle}
            onCancel={() => {
              titleCancelled.current = true;
              setTitleDraft(null);
              setRenaming(false);
            }}
            open={menu === "board"}
            onOpen={(open) => setMenu(open ? "board" : null)}
            readOnly={writeBlocked}
            items={menuItemsFrom(roomCommands, ctx, t)}
          />
          <SaveLine saveState={saveState} readOnly={readOnly} />
        </div>

        {/* The centre of the header stays empty: identity left, session right. */}
        <div className="topbar-spacer" />

        <div className="topbar-right">
          <PeopleMenu
            open={menu === "people"}
            onOpen={(open) => setMenu(open ? "people" : null)}
            peers={peers}
            self={self}
            boardId={boardId}
            role={role}
            narrow={narrow}
            followTarget={props.follow.target}
            onToggleFollow={toggleFollow}
            myFollowers={myFollowers}
            onFollow={() => {
              close();
              setFollowOpen(true);
            }}
          />

          <span className="topbar-anchor" ref={runAnchor}>
            <Button
              variant="ghost"
              icon="play"
              iconEnd={narrow ? undefined : "chevron-down"}
              className={isLive ? "run-trigger is-live" : "run-trigger"}
              aria-label={t("facilitation.menu")}
              aria-haspopup="menu"
              aria-expanded={menu === "run"}
              onClick={() => setMenu(menu === "run" ? null : "run")}
            >
              {!narrow && t("facilitation.menu")}
              {narrow && isLive && <span className="topbar-dot" aria-hidden="true" />}
            </Button>
            {menu === "run" && (
              <Menu
                label={t("facilitation.menu")}
                width={288}
                onClose={close}
                items={menuItemsFrom(runCommands, ctx, t)}
              >
                <div className="menu-reactions" role="group" aria-label={t("reactions.title")}>
                  {reactionCommands().map((command: ChromeCommand, index) => {
                    const reaction = REACTIONS[index];
                    if (!reaction) return null;
                    return (
                      <button
                        key={command.id}
                        type="button"
                        role="menuitem"
                        tabIndex={-1}
                        className="menu-reaction"
                        data-command={command.id}
                        aria-label={t(reaction.key)}
                        title={t(reaction.key)}
                        onClick={() => command.run(ctx)}
                      >
                        {reaction.emoji}
                      </button>
                    );
                  })}
                </div>
              </Menu>
            )}
            {!narrow && timerRunning && (
              <button
                type="button"
                className={timerDanger ? "session-chip is-danger" : "session-chip"}
                aria-label={`${t("facilitation.timer.button")}: ${timerHint}`}
                title={timerHint}
                onClick={() => setTimerOpen(true)}
              >
                {formatRemaining(timerLeft)}
              </button>
            )}
            {!narrow && voteRunning && (
              <button
                type="button"
                className="session-chip"
                aria-label={`${t("facilitation.vote.button")}: ${voteHint}`}
                title={voteHint}
                onClick={() => setVoteOpen(true)}
              >
                {voteTotal > 0
                  ? t("facilitation.vote.chip", { n: voteTotal })
                  : t("facilitation.vote.button")}
              </button>
            )}
          </span>

          {agentVisible && (
            <span className="topbar-anchor topbar-wide-only" ref={agentAnchor}>
              <Button
                variant="ghost"
                icon="agent"
                iconEnd="chevron-down"
                className="agent-trigger"
                aria-haspopup="menu"
                aria-expanded={menu === "agent"}
                onClick={() => setMenu(menu === "agent" ? null : "agent")}
              >
                {t("roomAgent.menu")}
                {roomAgent?.status && (
                  <span className={`agent-trigger-dot ${roomAgent.status}`} aria-hidden="true" />
                )}
              </Button>
              {menu === "agent" && (
                <Menu
                  label={t("roomAgent.menu")}
                  width={272}
                  onClose={close}
                  items={menuItemsFrom(agentCommands, ctx, t)}
                />
              )}
            </span>
          )}

          <Tooltip
            label={
              commentsUnread
                ? t("board.unreadComments", { n: commentsUnread })
                : t("board.discussion")
            }
            align="end"
          >
            <IconButton
              icon="comment"
              className="topbar-wide-only"
              label={
                commentsUnread
                  ? t("board.unreadComments", { n: commentsUnread })
                  : t("board.discussion")
              }
              count={commentsUnread || undefined}
              selected={commentsOpen}
              onClick={() => setCommentsOpen(!commentsOpen)}
            />
          </Tooltip>

          <Tooltip
            label={copied ? t("board.copied") : canShare ? t("share.title") : t("board.copyLinkTitle")}
            align="end"
          >
            <Button
              variant="primary"
              icon={copied ? "check" : "share"}
              className="topbar-invite"
              aria-label={t("board.share")}
              onClick={() => (canShare ? setShareOpen(true) : void copyShareLink())}
            >
              <span className="topbar-invite-label">{t("board.share")}</span>
            </Button>
          </Tooltip>

          <AccountMenu
            open={menu === "account"}
            onOpen={(open) => setMenu(open ? "account" : null)}
            name={name}
            self={self}
            color={identity.color}
            signedIn={Boolean(me)}
            handle={me?.handle ?? ""}
            roleLine={roleLine}
            identityName={identity.name}
            onRenameSelf={renameSelf}
            onAccountRenamed={onAccountRenamed}
            onSessions={() => setSessionsOpen(true)}
            onSignIn={() => setAuthOpen(true)}
            onSignOut={onSignOut}
            onAllRooms={onOpenHome}
            onOrg={() => setAccountOpen(true)}
            theme={theme}
            setTheme={setTheme}
            lang={lang}
            setLang={setLang}
            narrow={narrow}
            agentAvailable={agentVisible}
            onAgent={onOpenRoomAgent}
            onComments={() => setCommentsOpen(!commentsOpen)}
          />
        </div>
      </header>

      {menu === "templates" && (
        <span className="topbar-templates-anchor" ref={templateAnchor}>
          <Popover title={t("board.templates")} width={320} onClose={close}>
            <p className="muted topbar-hint">
              {writeBlocked ? t("iam.readOnly") : t("more.templatesHint")}
            </p>
            <div className="topbar-template-list">
              {templates.map((template) => (
                <Button
                  key={template.key}
                  variant="secondary"
                  size="default"
                  className="topbar-template"
                  disabled={writeBlocked}
                  onClick={() => {
                    addTemplate(template.key);
                    close();
                  }}
                >
                  <Icon name="template" size={16} />
                  {template.label}
                </Button>
              ))}
            </div>
          </Popover>
        </span>
      )}

      {planFrozen && (
        <div className="plan-frozen-bar" role="status">
          <span>{t("billing.frozenRoom")}</span>
          <Button size="compact" variant="ghost" onClick={onOpenBilling}>
            {t("billing.seePlans")}
          </Button>
        </div>
      )}
      {confirmReplace && (
        <ConfirmDialog
          title={t("board.replaceHeading")}
          confirmLabel={t("board.replaceAction")}
          onCancel={() => setConfirmReplace(false)}
          onConfirm={() => {
            setConfirmReplace(false);
            onReplace();
          }}
        >
          {t("board.replaceConfirm")}
        </ConfirmDialog>
      )}
      <SessionsDialog
        open={sessionsOpen}
        onClose={() => setSessionsOpen(false)}
        onCurrentRevoked={() => {
          setSessionsOpen(false);
          onSignOut();
        }}
      />
    </>
  );
}

export type { MenuView };
