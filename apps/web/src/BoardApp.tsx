import { FacilitationPanel } from "./FacilitationPanel";
import { setAllowBringEveryone, setWidgetPositions } from "@remo/doc";
import { useEffect, useRef, useState } from "react";
import type { FitObjects } from "./useBoardCameraFit";
import { currentRoom } from "./identity";
import { saveSettings } from "./settings";
import { BoardCanvas } from "./BoardCanvas";
import { BoardDialogs } from "./BoardDialogs";
import { BoardPanels } from "./BoardPanels";
import { GuestLinkEntry } from "./GuestLinkEntry";
import { BoardTopbar } from "./BoardTopbar";
import { BoardInspector } from "./BoardInspector";
import { CanvasChrome } from "./BoardOverlays";
import { BoardStart } from "./BoardStart";
import { ContextMenu } from "./ContextMenu";
import { CommandSearch } from "./CommandSearchDialog";
import { useConsentHold } from "./ConsentProvider";
import { InfoCard } from "./InfoCard";
import { MoveNotice } from "./MoveNotice";
import { RoomAgentPanel } from "./RoomAgentPanel";
import { ToolRail } from "./ToolRail";
import { useBoardAppState } from "./useBoardAppState";
import {
  CHROME_COMMANDS,
  type ChromeCommand,
  type ChromeContext,
} from "./commands";
import { useChromeSurfaceRegistration } from "./chromeSurfaces";

/**
 * The board screen: one tool rail, one canvas, and the overlays around it.
 *
 * State, effects and the commands they wire live in `useBoardAppState`; what is left
 * here is the layout, so a change to the screen does not have to be read past two
 * hundred lines of hooks (ADR-093).
 */
export function BoardApp() {
  const fitObjectsRef = useRef<FitObjects>(null);
  const {
    board,
    widgets,
    kanbanStates,
    title,
    groupNames,
    tags,
    allowBringEveryone,
    t,
    selectedIds,
    setSelectedIds,
    focusedWaypoint,
    pendingDelete,
    setPendingDelete,
    notice,
    showNotice,
    identity,
    cameraEpoch,
    settings,
    setSettings,
    settingsOpen,
    setSettingsOpen,
    templateRequest,
    setTemplateRequest,
    shareOpen,
    setShareOpen,
    exportOpen,
    setExportOpen,
    accountOpen,
    setAccountOpen,
    accountTab,
    openAccount,
    agentOpen,
    setAgentOpen,
    tidy,
    facilitationTab, setFacilitationTab,
    timerOpen,
    setTimerOpen,
    followOpen,
    setFollowOpen,
    appsOpen,
    setAppsOpen,
    commentRequest,
    me,
    setMe,
    refreshOrgs,
    access,
    refreshAccess,
    boardOrgId,
    boardTitle,
    authOpen,
    setAuthOpen,
    canShare,
    canExport,
    canBackup,
    canImport,
    canAskAgents,
    canFacilitate,
    canManage,
    canTransfer,
    denied,
    anonymousLink,
    renameSelf,
    openBoard,
    revealWidget,
    openHome, homeHref, teamHref, boardTeam, boardIcon,
    readOnly,
    connection,
    status,
    synced,
    saveState,
    visiblePresence,
    writeBlocked,
    roomAgent,
    vote,
    voteOpen,
    setVoteOpen,
    cast,
    withdraw,
    hintAllowed,
    editingId,
    setEditingId,
    follow,
    dispatchFollow,
    followInvite,
    setFollowInvite,
    myFollowers,
    followerNames,
    otherPeers,
    toggleFollow,
    stopFollowers,
    bringEveryone,
    timerWidget,
    currentTimerPhase,
    timerLeft,
    timerSetBy,
    startSharedTimer,
    pause,
    resume,
    extend,
    reset,
    header,
    presentOpen,
    setPresentOpen,
    commentsOpen,
    setCommentsUnread,
    reactionRequest,
    react,
    restoreRequest,
    requestRestore,
    trashOpen,
    setTrashOpen,
    trashBoard,
    duplicateBoard,
    signOutAndForgetName,
    applyImportedCamera,
    titleDraft,
    setTitleDraft,
    titleCancelled,
    renameBoard,
    copied,
    copyShareLink,
    shareFallback,
    closeShareFallback,
    inspectorOpen,
    closeProperties,
    toggleProperties,
    setCommentsPanel,
    openAgentPanel,
    active,
    addTemplate,
    replaceBoard,
    counts,
    onCursor,
    info,
    closeInfo,
    applyPlan,
    addStickyAndEdit,
    addTable,
    addKanban,
    rail,
    creationTool, suggestSeries,
    editWidget,
    claimBoard,
    menu,
    openMenu,
    closeMenu,
    voteTimerEndsAt,
    textOf,
    deltaOf,
    onSetText,
    moveMany,
    moveToCell,
    patchConnector,
    selectionLocked,
    resizeSelection,
    rotateSelection,
    onMoveCard,
    onAddCard,
    onAddColumn,
    canJoinSelection,
    connectSelection,
    onConnect,
    commandContext,
    addConnectedNote,
    stickyActions,
    noteMarks,
    connectorActions,
    arrangeActions,
    gatherSelection,
    onAddWaypoint,
    onMoveWaypoint,
    onDeleteWaypoint,
    onReattachEnd,
  } = useBoardAppState();

  /**
   * The search's "ask the agent" line hands its text to the agent dialog and runs nothing
   * itself (ADR-266 §1.2). The draft lives here so closing the dialog forgets it.
   */
  const [agentDraft, setAgentDraft] = useState("");
  const askAgent = (text: string) => {
    setAgentDraft(text);
    setAgentOpen(true);
  };

  /**
   * «More» on the rail is the command registry, not a second list (T8, ADR-266).
   *
   * The five creation rows are chrome commands: their ids are what ⌘K finds, their
   * actions live here because the rail's creation paths do. `chromeSurfaces` dispatches
   * the same ids from the search, so a row cannot exist in one surface only.
   */
  const canComment = Boolean(access?.capabilities.includes("board.comment"));
  const railCtx: ChromeContext = {
    can: {
      create: !writeBlocked,
      comment: canComment,
      templates: !writeBlocked,
    },
    run: (id) => {
      if (id === "canvas.addCard") rail.onCard();
      else if (id === "canvas.addTable") addTable();
      else if (id === "canvas.addKanban") addKanban();
      else if (id === "canvas.addComment") rail.onComment();
      else if (id === "room.template") setTemplateRequest((value) => value + 1);
    },
  };
  useChromeSurfaceRegistration("rail", railCtx);
  const railMore = [
    "canvas.addCard",
    "canvas.addTable",
    "canvas.addKanban",
    "canvas.addComment",
    "room.template",
  ]
    .map((id) => CHROME_COMMANDS.find((command) => command.id === id))
    .filter((command): command is ChromeCommand => Boolean(command))
    .map((command) => {
      const available = command.available(railCtx);
      return {
        id: command.id,
        label: t(command.title),
        icon: command.icon ?? "plus",
        disabled: available !== true,
        reason: available === true ? undefined : t(available.reason),
        onSelect: () => command.run(railCtx),
      };
    });

  // §6.5: the cookie plate waits while a presentation or a followed camera owns the
  // screen. The state lives here, so the rule is a prop of the room, not a DOM guess.
  useConsentHold(presentOpen || follow.target !== null);

  /**
   * Escape closes the one side panel (ADR-266 §5) when the key belongs to the chrome:
   * a panel, the header or the rail. On the canvas Escape is the selection's key, and
   * in the editor it ends the edit; a menu or a dialog owns it first.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (document.querySelector('[role="dialog"], .rm-menu, .rm-popover')) return;
      // The editor and a field handle Escape themselves; focus may already have moved
      // to the body by the time the event reaches the document.
      if (
        event.target instanceof HTMLElement &&
        event.target.closest('input, textarea, select, [contenteditable="true"], .inline-editor')
      ) {
        return;
      }
      const active = document.activeElement;
      const chrome =
        active instanceof HTMLElement &&
        Boolean(active.closest(".topbar, .tool-rail, .inspector, .comments-panel"));
      if (!chrome) return;
      if (commentsOpen) setCommentsPanel(false);
      else if (inspectorOpen) closeProperties();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [closeProperties, commentsOpen, inspectorOpen, setCommentsPanel]);

  return (
    <div className={`app${inspectorOpen ? "" : " no-inspector"}${anonymousLink ? " guest-room" : ""}`}>
      <FacilitationPanel tab={facilitationTab} onChange={setFacilitationTab}>
      <MoveNotice />
      <BoardDialogs
        onRevealSession={ids => fitObjectsRef.current?.(ids) ?? false}
        board={board}
        widgets={widgets}
        kanbanStates={kanbanStates}
        selectedIds={selectedIds}
        settings={settings}
        access={access}
        me={me}
        identity={identity}
        boardId={currentRoom()}
        boardTitle={title || boardTitle || ""}
        boardOrgId={boardOrgId ?? null}
        onRefreshAccess={refreshAccess}
        onSignedIn={(user) => {
          setMe(user);
          void refreshAccess();
        }}
        authOpen={authOpen}
        setAuthOpen={setAuthOpen}
        exportOpen={exportOpen}
        setExportOpen={setExportOpen}
        restoreRequest={restoreRequest}
        canExport={canExport}
        canBackup={canBackup}
        canImport={canImport}
        onImported={() => {
          setExportOpen(false);
          setSelectedIds([]);
          applyImportedCamera();
          showNotice(t("export.importDone"));
        }}
        appsOpen={appsOpen}
        setAppsOpen={setAppsOpen}
        timerOpen={timerOpen}
        timerWidget={timerWidget}
        timerPhase={currentTimerPhase}
        timerLeft={timerLeft}
        timerSetBy={timerSetBy}
        canFacilitate={canFacilitate}
        onStartTimer={startSharedTimer}
        onPauseTimer={pause}
        onResumeTimer={resume}
        onExtendTimer={extend}
        onResetTimer={reset}
        followOpen={followOpen}
        followerNames={followerNames}
        otherPeers={otherPeers}
        allowBringEveryone={allowBringEveryone}
        onStopFollowers={stopFollowers}
        onBringEveryone={bringEveryone}
        onToggleAuto={(enabled) => setAllowBringEveryone(board, enabled)}
        vote={vote}
        voteOpen={voteOpen}
        setVoteOpen={setVoteOpen}
        voteTimerEndsAt={voteTimerEndsAt}
        setSelectedIds={setSelectedIds}
        onReveal={revealWidget}
        shareFallback={shareFallback}
        onCloseShareFallback={closeShareFallback}
        shareOpen={shareOpen && canShare}
        setShareOpen={setShareOpen}
        canTransfer={canTransfer}
        canManage={canManage}
      />
      <BoardPanels
        board={board}
        accountOpen={accountOpen}
        accountTab={accountTab}
        me={me}
        onCloseAccount={() => setAccountOpen(false)}
        onSignedOut={() => {
          setMe(null);
          setAgentOpen(false);
          void refreshAccess();
        }}
        agentOpen={agentOpen && canAskAgents}
        agentIntent={agentDraft}
        tidy={tidy}
        boardId={currentRoom()}
        boardTitle={title || boardTitle || ""}
        access={access}
        selectedIds={selectedIds}
        setSelectedIds={setSelectedIds} writeBlocked={writeBlocked}
        widgets={widgets}
        onApplyPlan={applyPlan}
        onCloseAgent={() => {
          setAgentOpen(false);
          setAgentDraft("");
        }}
        onOpenOrg={() => {
          setAgentOpen(false);
          openAccount("agents");
        }}
        settingsOpen={settingsOpen} settings={settings}
        onChangeSettings={(next) => {
          setSettings(next);
          saveSettings(next);
        }}
        onCloseSettings={() => setSettingsOpen(false)}
        refreshOrgs={refreshOrgs}
        boardOrgId={boardOrgId ?? null}
        trashOpen={trashOpen}
        onCloseTrash={() => setTrashOpen(false)}
        onConfirmTrash={() => void trashBoard()}
      />
      <RoomAgentPanel {...roomAgent.panelProps} />
      <CommandSearch
        objectContext={commandContext}
        canAskAgents={canAskAgents}
        onAskAgent={askAgent}
      />
      {anonymousLink && <GuestLinkEntry identity={identity} renameSelf={renameSelf} />}
      <BoardTopbar
        anonymousLink={anonymousLink}
        {...header}
        setPresentOpen={setPresentOpen}
        title={title || boardTitle || ""}
        titleDraft={titleDraft}
        setTitleDraft={setTitleDraft}
        titleCancelled={titleCancelled}
        renameBoard={renameBoard}
        boardId={currentRoom()}
        role={access?.role ?? null}
        writeBlocked={writeBlocked}
        readOnly={readOnly}
        onOpenHome={openHome}
        homeHref={homeHref}
        teamHref={teamHref}
        teamName={boardTeam?.name} boardIcon={boardIcon} onAppearanceSaved={refreshAccess}
        canShare={canShare}
        copied={copied}
        copyShareLink={copyShareLink}
        setShareOpen={setShareOpen}
        canExport={canExport}
        canExportPdf={access?.pdfExportAvailable === true}
        canBackup={canBackup}
        canImport={canImport}
        canDuplicate={canManage}
        canDelete={Boolean(access?.capabilities.includes("board.delete"))}
        canFacilitate={canFacilitate}
        canAskAgents={canAskAgents}
        canUseApps={Boolean(boardOrgId)}
        setSettingsOpen={setSettingsOpen}
        setExportOpen={setExportOpen}
        onRestore={() => {
          requestRestore();
          setExportOpen(true);
        }}
        onDuplicate={() => void duplicateBoard()}
        onTrash={() => setTrashOpen(true)}
        onReplace={replaceBoard}
        voteRunning={vote.running}
        voteTotal={vote.active?.votes.reduce((total, entry) => total + entry.votes, 0) ?? 0}
        timerRunning={currentTimerPhase === "running"}
        timerLeft={timerLeft}
        setVoteOpen={setVoteOpen}
        setTimerOpen={setTimerOpen}
        setFollowOpen={setFollowOpen}
        setAgentOpen={setAgentOpen}
        {...roomAgent.barProps}
        onOpenRoomAgent={openAgentPanel}
        onOpenAgentSettings={() => openAccount("agents")}
        setAppsOpen={setAppsOpen}
        onReact={react}
        setCommentsOpen={setCommentsPanel}
        follow={follow}
        toggleFollow={toggleFollow}
        myFollowers={myFollowers}
        otherPeers={otherPeers}
        visiblePresence={visiblePresence}
        me={me}
        identity={identity}
        renameSelf={renameSelf}
        setAccountOpen={(value) => (value ? openAccount("people") : setAccountOpen(false))}
        setAuthOpen={setAuthOpen}
        onSignOut={() => void signOutAndForgetName()}
        saveState={saveState}
        toggleInspector={toggleProperties}
        addTemplate={addTemplate}
        templateRequest={templateRequest}
      />
      <BoardStart
        state={{
          blocked: saveState.blocked,
          offline: saveState.state === "offline" && !(notice && typeof notice === "object"),
          placing: Boolean(creationTool),
          synced,
          hasPeers: otherPeers > 0,
          widgets,
          denied,
          reason: access?.reason,
          signedIn: Boolean(me),
          boardId: currentRoom(),
          readOnly: writeBlocked,
        }}
        onCreateNote={addStickyAndEdit}
        onExample={() => setTemplateRequest((value) => value + 1)}
        onAskAgent={canAskAgents ? () => setAgentOpen(true) : null}
        onInvite={canShare ? () => setShareOpen(true) : null}
        onSignIn={() => setAuthOpen(true)}
        onHome={openHome}
        onClaim={() => void claimBoard()}
      />

      <div className="workspace">
        <ToolRail {...rail} more={railMore} />
        <BoardCanvas
          fitObjectsRef={fitObjectsRef}
          boardTitle={title || boardTitle || ""}
          board={board}
          connection={connection}
          canFacilitate={canFacilitate}
          meId={me?.id ?? null}
          canComment={Boolean(access?.capabilities.includes("board.comment"))}
          canManage={Boolean(access?.capabilities.includes("board.manage"))}
          commentRequest={commentRequest}
          widgets={widgets}
          voteSession={vote.active}
          voteBusy={vote.busy}
          voteOffset={vote.offset}
          voteTimerEndsAt={voteTimerEndsAt}
          timerLeft={timerLeft}
          onVote={cast}
          onWithdrawVote={withdraw}
          onOpenVote={() => setVoteOpen(true)}
          presentationOpen={presentOpen}
          onPresentationOpen={setPresentOpen}
          commentsOpen={commentsOpen}
          onCommentsOpen={setCommentsPanel}
          onCommentsUnread={setCommentsUnread}
          reactionRequest={reactionRequest}
          groupNames={groupNames}
          tags={tags}
          kanbanStates={kanbanStates}
          selectedIds={selectedIds}
          onSelect={setSelectedIds}
          onNotice={showNotice}
          onMoveMany={moveMany} onMoveToCell={moveToCell}
          onResizeMany={resizeSelection}
          onRotateMany={rotateSelection}
          onMoveCard={onMoveCard}
          onCreateFirstSticker={(at) => addStickyAndEdit(undefined, at)}
          onAddCard={onAddCard}
          onAddColumn={onAddColumn}
          onConnect={onConnect}
          presence={visiblePresence}
          onCursor={onCursor}
          onContextMenu={(target, point) => openMenu(target, point)}
          openColumn={menu?.column}
          textOf={textOf}
          deltaOf={deltaOf}
          onSetText={onSetText}
          stickyActions={stickyActions}
          noteMarks={noteMarks}
          onCreateConnected={addConnectedNote}
          connectorActions={connectorActions}
          arrangeActions={arrangeActions}
          onConnectorPatch={patchConnector}
          onAddWaypoint={onAddWaypoint}
          onMoveWaypoint={onMoveWaypoint}
          onDeleteWaypoint={onDeleteWaypoint}
          onLimit={() => showNotice(t("line.limit"))}
          onReattachEnd={onReattachEnd}
          focusedWaypoint={focusedWaypoint}
          editingId={editingId}
          onEdit={editWidget}
          synced={synced} fitKey={`${active}#${cameraEpoch}`}
          grid={settings.grid.style}
          hintAllowed={hintAllowed && !writeBlocked}
          settings={settings}
          readOnly={writeBlocked}
          suggestSeries={suggestSeries}
          creationTool={creationTool}
        />
        <CanvasChrome
          follow={follow}
          dispatchFollow={dispatchFollow}
          followInvite={followInvite}
          onAcceptFollow={(invite) => {
            dispatchFollow({ type: "follow", target: invite.from,
              label: invite.name ?? invite.from });
            setFollowInvite(null);
          }}
          onDismissFollow={() => setFollowInvite(null)}
          notice={notice}
          pendingDelete={pendingDelete}
          board={board}
          onCancelDelete={() => setPendingDelete(null)}
          onDeleted={() => {
            setSelectedIds([]);
            setPendingDelete(null);
          }}
        />
        <ContextMenu state={menu} onClose={closeMenu} />
        <InfoCard state={info} onClose={closeInfo} onOpenThread={roomAgent.openFromFrame} />
      <BoardInspector
        onNotice={showNotice}
        toggleInspector={closeProperties}
        selectedIds={selectedIds}
        setSelectedIds={setSelectedIds}
        writeBlocked={writeBlocked}
        commandContext={commandContext}
        widgets={widgets}
        board={board}
        setWidgetPositions={setWidgetPositions}
        canJoinSelection={canJoinSelection}
        connectSelection={connectSelection}
        setEditingId={setEditingId}
        selectionLocked={selectionLocked}
        counts={counts}
        kanbanStates={kanbanStates}
        status={status}
        visiblePresence={visiblePresence}
        onOpenObject={openBoard}
        stickyActions={stickyActions}
        settings={settings}
        editingId={editingId}
        onGather={gatherSelection}
      />
      </div>
      </FacilitationPanel>
    </div>
  );
}
