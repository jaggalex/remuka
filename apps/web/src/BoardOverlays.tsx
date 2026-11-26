import type { BoardNotice } from "./useNotice";
import { Button } from "@remo/ui";
import { RoomGateCard } from "./RoomGateCard";
import { LinkPasswordGate } from "./LinkPasswordGate";
import type { BoardDocument } from "@remo/doc";
import { DeleteConfirmation } from "./DeleteDialog";
import { HelpLink } from "./help/HelpLink";
import type { FollowEvent, FollowState } from "./follow";
import { useI18n } from "./i18n";
import { useBoardOperatorNotice } from "./accessSnapshot";
import { EmptyRoomStart } from "./EmptyRoomStart";

/**
 * The banners and pills that float over the canvas.
 *
 * They are presentational: App decides what is true (access, follow, a notice) and
 * these components only say it. Grouping them keeps App's JSX about the board itself.
 */

/** A viewer without access sees why, and the one action that can change it. */
export function BoardAccessGate({
  reason,
  signedIn,
  boardId,
  onSignIn,
  onHome,
  onClaim,
}: {
  reason: string | null | undefined;
  signedIn: boolean;
  boardId: string;
  onSignIn: () => void;
  onHome: () => void;
  onClaim: () => void;
}) {
  const { t } = useI18n();
  if (reason === "PASSWORD_REQUIRED") {
    return <LinkPasswordGate boardId={boardId} onUnlocked={() => window.location.reload()} />;
  }
  const unclaimed = reason === "UNCLAIMED";
  const inactive = reason === "LINK_INACTIVE";
  // A room can require a fresh login while the tab still remembers the old account.
  const signIn = reason === "AUTH_REQUIRED" || (!signedIn && (inactive || unclaimed));
  const title = unclaimed ? t("iam.gateUnclaimed") : inactive ? t("iam.gateInactive")
    : signIn ? t("iam.gateSignIn") : t("iam.noAccess");
  const description = unclaimed ? t("iam.unclaimed") : inactive ? t("iam.linkInactive")
    : signIn ? t("iam.signInToOpen") : t("iam.noAccessHint");
  return (
    <RoomGateCard title={title} description={description}>
      <Button variant="primary" onClick={signIn ? onSignIn : unclaimed ? onClaim : onHome}>
        {unclaimed ? t(signedIn ? "iam.claim" : "iam.claimLogin") : t(signIn ? "auth.login" : "iam.gateHome")}
      </Button>
      {signIn && inactive && <Button variant="ghost" onClick={onHome}>{t("iam.gateHome")}</Button>}
    </RoomGateCard>
  );
}

/** Following someone is attention, not board state: a pill, and either side can stop. */
export function FollowPill({
  follow,
  dispatch,
}: {
  follow: FollowState;
  dispatch: (event: FollowEvent) => void;
}) {
  const { t } = useI18n();
  if (!follow.target) return null;
  return (
    <div className={`follow-pill${follow.paused ? " paused" : ""}`} role="status">
      <span>
        {follow.paused
          ? t("follow.paused", { name: follow.targetLabel ?? follow.target })
          : t("follow.following", { name: follow.targetLabel ?? follow.target })}
      </span>
      <Button
        onClick={() => dispatch(follow.paused ? { type: "resume" } : { type: "unfollow" })}>
        {follow.paused ? t("follow.resume") : t("follow.stop")}
      </Button>
      {follow.paused && (
        <Button onClick={() => dispatch({ type: "unfollow" })}>
          {t("follow.stop")}
        </Button>
      )}
      <HelpLink topicId="facilitation.follow" />
    </div>
  );
}

/** "Bring everyone": the invitation stays until the person answers it. */
export function FollowInvite({
  from,
  name,
  onAccept,
  onDismiss,
}: {
  from: string;
  /** The session's label; `from` is its key. */
  name?: string;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="follow-invite" role="status" aria-label={t("follow.inviteTitle")}>
      <span>{t("follow.invite", { name: name ?? from })}</span>
      <div className="follow-invite-actions">
        <Button variant="primary" onClick={onAccept}>
          {t("follow.accept")}
        </Button>
        <Button onClick={onDismiss}>
          {t("follow.stay")}
        </Button>
      </div>
    </div>
  );
}

/** A short-lived message about what just happened (or why it did not). */
export function CanvasNotice({ message }: { message: BoardNotice | null }) {
  if (!message) return null;
  if (typeof message !== "string") {
    return (
      <div className="canvas-notice room-connection-notice" data-kind={message.kind} role="alert">
        <span>{message.text}</span>
        {message.action && <Button onClick={message.action.run}>{message.action.label}</Button>}
      </div>
    );
  }
  return (
    <div className="canvas-notice" role="status">
      {message}
    </div>
  );
}

/**
 * "Drop to add" — the dashed frame that covers the canvas while files are dragged over it
 * (`spec/images.md` §9.2).
 *
 * It is an application overlay, not a document object: nothing about a half-arrived
 * picture belongs in the room. The count is what the drag carries, which is the only
 * honest number before the drop — the names of the files arrive with the drop itself.
 */
export function ImageDropFrame({ label }: { label: string }) {
  const { t } = useI18n();
  return (
    <div className="image-drop" aria-hidden="true">
      <div className="image-drop-frame">
        <p className="image-drop-title">{t("image.drop.title")}</p>
        <p className="image-drop-count">{label}</p>
      </div>
    </div>
  );
}

/** A full queue takes priority over the notice that editing can continue offline. */
function OfflineNotice({ blocked, readOnly }: { blocked: boolean; readOnly: boolean }) {
  const { t } = useI18n();
  const heading = blocked ? "sync.queueFull" : "sync.offline";
  const message = blocked ? "sync.queueFullBody" : readOnly ? "sync.offlineViewer" : "sync.offlineBody";
  return (
    <div className={`canvas-notice room-connection-notice ${blocked ? "offline-blocked" : "offline-notice"}`}
      data-kind={blocked ? "blocked" : "offline"} role={blocked ? "alert" : "status"} aria-atomic="true">
      <span><strong>{t(heading)}.</strong>{" "}{t(message)}</span>
    </div>
  );
}

/**
 * Why the board cannot be used right now, in one place: a blocked queue, an empty
 * board, a denied board or an unclaimed room. App decides the facts; the layer only
 * orders them so a workspace can be denied and empty at once without a stack of ifs.
 */
export function BoardStateLayer({
  blocked, offline,
  emptyRoom,
  hasPeers,
  synced,
  denied,
  reason,
  signedIn,
  boardId,
  readOnly,
  onCreateNote,
  onExample,
  onAskAgent,
  onInvite,
  onSignIn,
  onHome,
  onClaim,
}: {
  blocked: boolean;
  offline: boolean;
  emptyRoom: string | null;
  hasPeers: boolean;
  synced: boolean;
  denied: boolean;
  reason: string | null | undefined;
  signedIn: boolean;
  boardId: string;
  readOnly: boolean;
  onCreateNote: () => void;
  onExample: () => void;
  /** Null when the room or organisation has no agent to ask. */
  onAskAgent: (() => void) | null;
  /** Null when the viewer may not invite anybody. */
  onInvite: (() => void) | null;
  onSignIn: () => void;
  onHome: () => void;
  onClaim: () => void;
}) {
  return (
    <>
      {!denied && (blocked || offline) && <OfflineNotice blocked={blocked} readOnly={readOnly} />}
      {emptyRoom && (
        <EmptyRoomStart
          readOnly={readOnly}
          hasPeers={hasPeers}
          synced={synced}
          onCreateNote={onCreateNote}
          onExample={onExample}
          onAskAgent={onAskAgent}
          onInvite={onInvite}
        />
      )}
      {denied && (
        <BoardAccessGate
          reason={reason}
          signedIn={signedIn}
          boardId={boardId}
          onSignIn={onSignIn}
          onHome={onHome}
          onClaim={onClaim}
        />
      )}
    </>
  );
}

/**
 * What floats over the canvas: the follow pill, its invitation, a notice and the
 * delete confirmation. One component so the workspace JSX stays about the board.
 */
export function CanvasChrome({
  follow,
  dispatchFollow,
  followInvite,
  onAcceptFollow,
  onDismissFollow,
  notice,
  pendingDelete,
  board,
  onCancelDelete,
  onDeleted,
}: {
  follow: FollowState;
  dispatchFollow: (event: FollowEvent) => void;
  followInvite: { from: string; name?: string } | null;
  onAcceptFollow: (invite: { from: string; name?: string }) => void;
  onDismissFollow: () => void;
  notice: BoardNotice | null;
  pendingDelete: string[] | null;
  board: BoardDocument;
  onCancelDelete: () => void;
  onDeleted: () => void;
}) {
  const { t } = useI18n();
  const operatorNotice = useBoardOperatorNotice();
  return (
    <>
      <FollowPill follow={follow} dispatch={dispatchFollow} />
      {operatorNotice && (
        <div className="operator-notice" role="status">
          {t(
            operatorNotice.kind === "link_disable"
              ? "iam.operatorLinkNotice"
              : "iam.operatorRoomNotice",
            { reason: operatorNotice.reason },
          )}
        </div>
      )}
      {followInvite && (
        <FollowInvite
          from={followInvite.from}
          name={followInvite.name}
          onAccept={() => onAcceptFollow(followInvite)}
          onDismiss={onDismissFollow}
        />
      )}
      <CanvasNotice message={notice} />
      {pendingDelete && (
        <DeleteConfirmation
          board={board}
          ids={pendingDelete}
          onCancel={onCancelDelete}
          onDeleted={onDeleted}
        />
      )}
    </>
  );
}
