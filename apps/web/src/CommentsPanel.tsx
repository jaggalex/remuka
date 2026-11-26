import { anchorAt, fromClient, pinWorld } from "./commentGeometry";
import { CommentPin } from "./CommentPin";
import { recordPinMove } from "./commentHistory";
import { HintCopy } from "./HintCopy";
import { actedOnHint } from "./hintCatalog";
import { homeAction } from "./homeAction";
import { useCallback, useEffect, useRef, useState } from "react";
import type { BoardConnection, BoardDocument, Presence } from "@remo/doc";
import { colorForAccount } from "@remo/doc";
import type { Camera, KanbanLayout } from "@remo/canvas";
import type { Widget } from "@remo/model";
import { commentsApi, type CommentAnchor, type CommentMessage, type CommentThread } from "./commentsApi";
import { currentRoom } from "./identity";
import { threadInFrame } from "./commentScope";
import { CommentPlacementLayer } from "./CommentPlacementLayer";
import { Button, ConfirmDialog as UiConfirmDialog, Dialog, IconButton, Textarea } from "@remo/ui";
import { formatMoment } from "./format";
import { deletedUserName } from "./deletedUser";
import { useI18n } from "./i18n";

/**
 * Discussion beside the board (ADR-104/105).
 *
 * Threads are server rows, so the panel can be opened by a commenter who has no document
 * write. The canvas stays visible, and a pin marks the place a thread belongs to. New
 * threads arrive as a socket nudge (message 11), not as a document update and not as a
 * timer: one mechanism for one job.
 */
export function CommentsPanel({
  board,
  connection,
  presence,
  widgets,
  camera,
  viewport,
  layouts,
  selectedIds,
  meId,
  canComment,
  canManage,
  commentRequest,
  onSelectWidget,
  open,
  onOpen,
  onUnread,
}: {
  board: BoardDocument;
  connection: BoardConnection | null;
  presence: Presence[];
  widgets: Widget[];
  camera: Camera;
  viewport: { width: number; height: number };
  layouts: Map<string, KanbanLayout>;
  selectedIds: readonly string[];
  meId: string | null;
  canComment: boolean;
  canManage: boolean;
  /** Increments when the rail asks for placement; the panel owns the mode. */
  commentRequest: number;
  onSelectWidget: (ids: string[]) => void;
  /** The header owns whether the panel is open; the rail can still ask for placement. */
  open: boolean;
  onOpen: (value: boolean) => void;
  /** Unread count for the header button; a badge the panel already computes. */
  onUnread: (value: number) => void;
}) {
  const { t, lang } = useI18n();
  const [threads, setThreads] = useState<CommentThread[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showResolved, setShowResolved] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [pendingAnchor, setPendingAnchor] = useState<CommentAnchor | null>(null);
  const composer = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pendingAnchor) return;
    // A direct object comment opens during the panel button gesture. Focus after the
    // dialog has mounted and restored its trigger, so typing goes into the new thread.
    const frame = requestAnimationFrame(() => composer.current?.querySelector("textarea")?.focus());
    return () => cancelAnimationFrame(frame);
  }, [pendingAnchor]);
  const [draft, setDraft] = useState("");
  const [pendingDelete, setPendingDelete] = useState<CommentMessage | null>(null);
  const [online, setOnline] = useState(() => connection?.status() === "connected");
  const boardId = currentRoom();
  const unread = threads.reduce((total, thread) => total + thread.unread, 0);
  const activeThread = threads.find((thread) => thread.id === active) ?? null;
  // A presenter sees the discussion of the slide being shown, not the whole board.
  const presentingFrameId =
    presence.find((peer) => peer.presenting)?.presenting?.frameId ?? null;
  useEffect(() => {
    onUnread(unread);
  }, [onUnread, unread]);

  const inFrame = threads.filter((thread) =>
    threadInFrame(thread, presentingFrameId, widgets),
  );
  const openThreads = inFrame.filter((thread) => !thread.resolvedAt);
  const resolvedThreads = inFrame.filter((thread) => Boolean(thread.resolvedAt));
  const visibleThreads = showResolved ? resolvedThreads : openThreads;

  const load = useCallback(async () => {
    try {
      const result = await commentsApi.list(boardId);
      setThreads(result.threads);
      setError("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }, [boardId]);

  useEffect(() => {
    void load();
    if (!connection) return;
    const offComments = connection.onCommentsChanged(() => void load());
    // A missed nudge while disconnected is recovered here, so the frame needs no queue.
    const offStatus = connection.onStatus((status) => {
      setOnline(status === "connected");
      if (status === "connected") void load();
    });
    return () => {
      offComments();
      offStatus();
    };
  }, [connection, load]);

  // More → Comment is the canvas placement tool, even if the last tool left a shape selected.
  useEffect(() => {
    if (!commentRequest) return;
    onOpen(true);
    setPlacing(true);
  }, [commentRequest]);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };

  const anchorLabel = (thread: CommentThread) => {
    const anchor = thread.anchor;
    if (anchor.kind === "point") return t("comments.point");
    const widget = widgets.find((entry) => entry.id === anchor.widgetId);
    if (!widget) return t("comments.orphan");
    return widget.title || widget.content || widget.id;
  };

  /**
   * The pin follows the anchor, not a stored screen position: a widget may be moved and
   * the camera moves all the time, so the place is recomputed from world coordinates.
   */
  const pinAt = (thread: CommentThread) => {
    const anchor = thread.anchor;
    const world = pinWorld(anchor, anchor.kind === "widget" ? widgets.find(w => w.id === anchor.widgetId) : undefined, layouts);
    if (!world) return null;
    return {
      x: viewport.width / 2 + (world.x - camera.x) * camera.zoom,
      y: viewport.height / 2 + (world.y - camera.y) * camera.zoom,
    };
  };

  const startPlacing = () => {
    if (!canComment || !online) return;
    actedOnHint("comments.closed");
    actedOnHint("comments.empty");
    onOpen(true);
    const id = selectedIds.length === 1 ? selectedIds[0] : null;
    if (id) {
      setPendingAnchor({ kind: "widget", widgetId: id, fx: .9, fy: .1 });
      setDraft("");
    } else setPlacing(true);
  };

  const movePin = (thread: CommentThread, clientX: number, clientY: number) => {
    const world = fromClient(clientX, clientY, camera);
    if (!world || !online) return;
    const next = anchorAt(world, widgets, layouts);
    async function apply(expected: CommentAnchor, anchor: CommentAnchor) {
      try {
        await commentsApi.move(boardId, thread.id, expected, anchor);
        await load();
      } catch (failure) {
        await load();
        setError(t("comments.moveFailed"));
        throw failure;
      }
    }
    setBusy(true);
    void apply(thread.anchor, next).then(() => {
      recordPinMove(board, reverse => reverse ? apply(next, thread.anchor) : apply(thread.anchor, next));
    }).catch(() => {}).finally(() => setBusy(false));
  };

  const anchorLabelOf = (anchor: CommentAnchor) => {
    if (anchor.kind === "point") return t("comments.point");
    const widget = widgets.find((entry) => entry.id === anchor.widgetId);
    return widget?.title || widget?.content || t("comments.orphan");
  };

  const submitComment = () => {
    if (!canComment || !pendingAnchor || !draft.trim() || !online) return;
    void run(async () => {
      const created = await commentsApi.create(boardId, pendingAnchor, draft.trim());
      setActive(created.thread.id);
      setPendingAnchor(null);
      setDraft("");
      onOpen(true);
    });
  };

  const sendReply = () => {
    if (!canComment || !activeThread || !reply.trim() || !online) return;
    void run(async () => {
      await commentsApi.reply(boardId, activeThread.id, reply.trim());
      setReply("");
    });
  };

  const openThread = (thread: CommentThread) => {
    setActive(thread.id);
    setReply("");
    if (thread.anchor.kind === "widget") onSelectWidget([thread.anchor.widgetId]);
    if (thread.unread) void commentsApi.read(boardId, thread.id).then(load).catch(() => {});
  };

  const [newsThread, setNewsThread] = useState(() => homeAction("mention"));
  useEffect(() => {
    if (!newsThread || !open) return;
    const thread = threads.find(row => row.id === newsThread);
    if (!thread) return;
    setNewsThread(null);
    openThread(thread);
    document.getElementById("thread-" + thread.id)?.scrollIntoView({ block: "nearest" });
  }, [threads, newsThread, open]);

  const remove = (comment: CommentMessage) => setPendingDelete(comment);

  /**
   * A pin is a person's mark, not a state of the room: its colour comes from the
   * author's account (ADR-267), so every client and an offline author see it alike.
   */
  const pinColour = (thread: CommentThread) =>
    colorForAccount(thread.createdBy ?? thread.comments[0]?.authorId ?? null);
  const pinLetter = (thread: CommentThread) => {
    const name = thread.createdByName || thread.comments[0]?.authorName || "?";
    return name.trim().charAt(0).toLocaleUpperCase() || "?";
  };

  return (
    <>
      <div className="comment-pins">
        {visibleThreads.map((thread) => {
          const point = pinAt(thread);
          if (!point) return null;
          return (
            <CommentPin key={thread.id} thread={thread} point={point} active={thread.id === active}
              movable={Boolean(online && !busy && canComment && (canManage || meId === thread.createdBy))}
              colour={pinColour(thread)} letter={pinLetter(thread)} title={anchorLabel(thread)}
              label={t("comments.openThread", { anchor: anchorLabel(thread) })}
              onOpen={() => { onOpen(true); openThread(thread); }}
              onDrop={(x, y) => movePin(thread, x, y)} />

          );
        })}
      </div>

      {placing && (
        <CommentPlacementLayer
          camera={camera}
          viewport={viewport}
          widgets={widgets}
          layouts={layouts}
          onPick={(anchor) => {
            setPlacing(false);
            setPendingAnchor(anchor);
            setDraft("");
          }}
          onCancel={() => setPlacing(false)}
        />
      )}

      {pendingAnchor && (
        <Dialog
          title={t("comments.new")}
          description={t("comments.anchor", { anchor: anchorLabelOf(pendingAnchor) })}
          size="md"
          onClose={() => setPendingAnchor(null)}
        >
          <div className="dialog-stack comment-composer" ref={composer}>
            <Textarea
              autoFocus
              aria-label={t("comments.prompt")}
              maxLength={4000}
              value={draft}
              placeholder={t("comments.prompt")}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") submitComment();
              }}
            />
            <div className="auth-actions">
              <Button onClick={() => setPendingAnchor(null)}>
                {t("comments.cancel")}
              </Button>
              <Button variant="primary"
                disabled={!draft.trim() || busy}
                onClick={submitComment}>
                {t("comments.create")}
              </Button>
            </div>
          </div>
        </Dialog>
      )}

      {pendingDelete && (
        <UiConfirmDialog
          title={t("comments.deleteTitle")}
          confirmLabel={t("delete.confirm")}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            const target = pendingDelete;
            setPendingDelete(null);
            void run(() => commentsApi.remove(boardId, target.id));
          }}
        >
          {t("comments.deleteConfirm")}
        </UiConfirmDialog>
      )}

      {open && (
        <aside
          className="comments-panel"
          aria-label={t("comments.title")}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              onOpen(false);
            }
          }}
        >
          <header>
            <h2 className="comments-title">{t("comments.title")}</h2>
            <div className="comments-head-actions">
              <Button
                size="compact"
                variant="secondary"
                disabled={!canComment || !online || busy}
                onClick={startPlacing}
              >
                {t("comments.new")}
              </Button>
              <IconButton
                icon="close"
                size="compact"
                label={t("comments.close")}
                onClick={() => onOpen(false)}
              />
            </div>
          </header>

          <div className="comments-tabs" role="tablist" aria-label={t("comments.title")}>
            <button
              type="button"
              role="tab"
              className={showResolved ? "comments-tab" : "comments-tab is-selected"}
              aria-selected={!showResolved}
              onClick={() => setShowResolved(false)}
            >
              {t("comments.tabOpen", { count: openThreads.length })}
            </button>
            <button
              type="button"
              role="tab"
              className={showResolved ? "comments-tab is-selected" : "comments-tab"}
              aria-selected={showResolved}
              onClick={() => setShowResolved(true)}
            >
              {t("comments.tabResolved", { count: resolvedThreads.length })}
            </button>
          </div>

          {presentingFrameId && <p className="muted comments-note">{t("comments.slide")}</p>}
          {!online && <p className="comments-offline">{t("comments.offline")}</p>}
          {error && <p className="auth-error">{error}</p>}

          <div className="comments-body">
            <ul className="comments-list">
              {visibleThreads.map((thread) => (
                <li key={thread.id} id={"thread-" + thread.id}>
                  <article
                    className={`comments-thread${thread.id === active ? " is-active" : ""}`}
                    onClick={() => openThread(thread)}
                  >
                    <span className="comments-about">
                      {t("comments.about", { anchor: anchorLabel(thread) })}
                    </span>
                    {thread.comments.map((comment) => (
                      <div key={comment.id} className="comment-message">
                        <span
                          className="comment-avatar"
                          style={{ background: colorForAccount(comment.authorId) }}
                          aria-hidden="true"
                        >
                          {(comment.authorName || "?").trim().charAt(0).toLocaleUpperCase()}
                        </span>
                        <div className="comment-body">
                          <span className="comment-meta">
                            <b>{deletedUserName(comment.authorName, t("user.deleted"))}</b>
                            <span>{formatMoment(comment.createdAt, lang)}</span>
                            {comment.editedAt && <span>{t("comments.edited")}</span>}
                          </span>
                          <p>{comment.deletedAt ? t("comments.deleted") : comment.body}</p>
                          {!comment.deletedAt && (comment.authorId === meId || canManage) && (
                            <Button
                              variant="ghost"
                              size="compact"
                              disabled={busy}
                              onClick={(event) => {
                                event.stopPropagation();
                                remove(comment);
                              }}
                            >
                              {t("comments.delete")}
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                    {!thread.resolvedAt && (
                      <div className="comment-reply">
                        <Textarea
                          rows={1}
                          disabled={!canComment || !online || busy}
                          value={active === thread.id ? reply : ""}
                          maxLength={4000}
                          aria-label={t("comments.replyPlaceholder")}
                          placeholder={online ? t("comments.replyHint") : t("comments.replyOffline")}
                          onFocus={() => setActive(thread.id)}
                          onChange={(event) => {
                            setActive(thread.id);
                            setReply(event.target.value);
                          }}
                          onKeyDown={(event) => {
                            if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
                            event.preventDefault();
                            sendReply();
                          }}
                        />
                        <Button
                          variant="secondary"
                          size="compact"
                          icon="check"
                          className="comment-resolve"
                          disabled={!canComment || !online || busy}
                          onClick={(event) => {
                            event.stopPropagation();
                            void run(() => commentsApi.resolve(boardId, thread.id, true));
                          }}
                        >
                          {t("comments.resolve")}
                        </Button>
                        {active === thread.id && reply.trim() && (
                          <Button
                            variant="primary"
                            size="compact"
                            className="comment-reply-send"
                            disabled={!canComment || busy || !online}
                            onClick={(event) => {
                              event.stopPropagation();
                              sendReply();
                            }}
                          >
                            {t("comments.send")}
                          </Button>
                        )}
                      </div>
                    )}
                  </article>
                </li>
              ))}
            </ul>
            {!visibleThreads.length && <p className="comments-empty">{showResolved ? <HintCopy slot="comments.empty" text="comments.empty" /> : <HintCopy slot="comments.closed" text="comments.emptyClosed" />}</p>}
          </div>
        </aside>
      )}
    </>
  );
}
