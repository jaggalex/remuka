import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  CLOSE_ROOM_FULL,
  OFFLINE_EDIT_LIMIT,
  connectBoard,
  usePresence,
  type BoardConnection,
  BoardDocument,
  type ConnectionStatus,
  type SaveState,
} from "@remo/doc";
import type { Access } from "./api";
import { currentRoom, syncUrl, type Identity } from "./identity";
import type { BoardNotice } from "./useNotice";
import { followMoved } from "./moved";
import { loadBrowserSession } from "./session";
import type { TranslationKey } from "./i18n";

/** A denied room renders an empty document. Only temporary reauthentication keeps
 * the previous account's document available for the next matching edit grant. */
export function useRoomDocument(room: string, access: Access | null, accountId: string | null) {
  const empty = useMemo(() => new BoardDocument(), [room]);
  const [retained, setRetained] = useState<{ key: string | null; board: BoardDocument }>({ key: null, board: empty });
  const principal = access?.principalId === undefined ? accountId : access.principalId;
  const key = access?.allowed ? JSON.stringify([room, principal, access.capabilities.includes("board.edit")]) : null;
  const temporarilyClosed = !access || access.reason === "AUTH_REQUIRED";
  if (key !== retained.key && (key !== null || !temporarilyClosed)) {
    const next = { key, board: key === null ? empty : new BoardDocument() };
    setRetained(next);
    return next.board;
  }
  return key === null ? empty : retained.board;
}

/**
 * The board's connection to its room, and the save state the topbar shows.
 *
 * The transport is additive: the document is already the source of truth, so remote
 * edits arrive as ordinary transactions. The socket follows the authorised document;
 * a new cursor name or language keeps that connection (ADR-149/151).
 */
export function useBoardSession({
  board,
  identity,
  accountId,
  accountHandle,
  access,
  refreshAccess,
  setNotice,
  setAuthOpen,
  t,
}: {
  board: BoardDocument;
  identity: Identity;
  /** The signed-in account; null for a guest. */
  accountId: string | null;
  /** The account handle; null for a guest. */
  accountHandle: string | null;
  access: Access | null;
  refreshAccess: () => Promise<void>;
  setNotice: (message: BoardNotice) => void;
  setAuthOpen: (open: boolean) => void;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
}) {
  // One tab is one session: its key survives a reload, a new tab gets a new one (ADR-151).
  const [session] = useState(loadBrowserSession);
  const [connection, setConnection] = useState<BoardConnection | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [synced, setSynced] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>({
    state: "connecting",
    pending: 0,
    blocked: false,
  });
  const presence = usePresence(connection?.awareness ?? null, session.key);

  // A link visitor sees no member names, avatars or presence (ADR-069). The awareness
  // object still exists for cursors and sync; only the presentation is emptied, so a
  // public link never becomes a people directory.
  const linkVisitor = Boolean(access?.sources.includes("link"));
  const visiblePresence = linkVisitor ? [] : presence;

  // The connect effect must not depend on words or on the cursor name: editing the name
  // used to destroy and rebuild the socket on every keystroke, and switching language did
  // the same. The callback reads the current translator through a ref.
  const tRef = useRef(t);
  tRef.current = t;
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const accountIdRef = useRef(accountId);
  accountIdRef.current = accountId;
  const accountHandleRef = useRef(accountHandle);
  accountHandleRef.current = accountHandle;

  const accessRef = useRef(access);
  accessRef.current = access;
  const [suspended, setSuspended] = useState<Access | null>(null);
  const authorised = !!access?.allowed && access !== suspended;
  const principal = access?.principalId === undefined ? accountId : access.principalId;
  const mode = access?.capabilities.includes("board.edit") ? "edit" : "view";
  const grantKey = access && [access.role, [...access.capabilities].sort().join(","), [...access.sources].sort().join(",")].join(":");
  const checkpoints = useRef(new WeakMap<BoardDocument, { local: number; acknowledged: number }>());

  useLayoutEffect(() => {
    if (!authorised) {
      setConnection(null);
      setSynced(false);
      setStatus("disconnected");
      const checkpoint = checkpoints.current.get(board);
      const pending = checkpoint ? Math.max(0, checkpoint.local - checkpoint.acknowledged) : 0;
      setSaveState({
        state: checkpoint ? "offline" : "connecting",
        pending,
        blocked: pending >= OFFLINE_EDIT_LIMIT,
      });
      return;
    }
    const checkpoint = checkpoints.current.get(board) ?? { local: 0, acknowledged: 0 };
    checkpoints.current.set(board, checkpoint);
    const connection = connectBoard(board, {
      url: syncUrl(),
      room: currentRoom(),
      params: { roomPrincipal: principal ?? "", roomMode: mode },
      disableBroadcast: true,
      pauseOnAccessChange: true,
      checkpoint,
      user: {
        name: identityRef.current.name,
        handle: accountHandleRef.current ?? "",
        color: identityRef.current.color,
        sessionKey: session.key,
        accountId: accountIdRef.current,
        joinedAt: session.joinedAt,
      },
      onAccessChanged: (code) => {
        setSuspended(accessRef.current);
        if (code === 4401) {
          setNotice({ kind: "session", text: tRef.current("sync.sessionEnded"),
            action: { label: tRef.current("auth.login"), run: () => setAuthOpen(true) } });
        } else {
          setNotice({ kind: "access", text: tRef.current("sync.accessChanged") });
        }
        void refreshAccess();
      },
      // A write budget closed the socket (ADR-173); the edits stay local until it reconnects.
      onLimited: (code) => {
        setNotice(code === CLOSE_ROOM_FULL
          ? { kind: "full", text: tRef.current("sync.roomFull") }
          : tRef.current("sync.rateLimited"));
      },
      // This address is retired (ADR-254 §6): one short banner, then the same page on
      // the new origin. Reconnecting here would only be closed the same way.
      onMoved: (target) => {
        const url = followMoved(target);
        setNotice(url
          ? { kind: "moved", text: tRef.current("sync.moved", { host: new URL(url).host }),
              action: { label: tRef.current("sync.openNow"), run: () => window.location.replace(url) } }
          : { kind: "moved", text: tRef.current("sync.movedUnknown") });
      },
    });
    setConnection(connection);
    setStatus(connection.status());
    setSynced(false);
    setSaveState(connection.saveState());
    const offStatus = connection.onStatus(setStatus);
    const offSynced = connection.onSynced(setSynced);
    const offSave = connection.onSaveState(setSaveState);
    return () => {
      offStatus();
      offSynced();
      offSave();
      connection.disconnect();
      setConnection(null);
    };
  }, [authorised, board, grantKey, mode, principal, refreshAccess, session, setNotice, setAuthOpen]);

  // A failed upgrade (401/403/404) reaches the browser as close 1006, not 4403, so the
  // access callback never fires. While disconnected, refresh the decision so a revoked
  // editor sees the gate instead of an endless offline queue.
  useEffect(() => {
    if (status !== "disconnected") return;
    const refresh = () => void refreshAccess();
    const timer = window.setInterval(refresh, 5_000);
    const wake = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
    };
  }, [status, refreshAccess]);

  // Renaming a cursor updates its current connection in place (ADR-149).
  // Two sessions of one account stay two entries (ADR-151).
  useEffect(() => {
    connection?.setUser({
      name: identity.name,
      handle: accountHandle ?? "",
      color: identity.color,
      sessionKey: session.key,
      accountId,
      joinedAt: session.joinedAt,
    });
  }, [connection, identity.name, identity.color, accountId, accountHandle, session]);

  return { connection, status, synced, saveState, presence, visiblePresence, linkVisitor, authorised };
}
