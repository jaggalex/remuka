import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react";
import { api, ApiError, type Access, type OrgSummary, type SessionUser } from "./api";
import { currentRoom } from "./identity";
import { publishAccess } from "./accessSnapshot";

/**
 * Who is signed in, and what this viewer may do with this board.
 *
 * One hook, one source: the server's `effective()` result is stored as-is, and every
 * capability in the UI is a read of that answer, not a local guess.
 */
export function useBoardAccess(room: string | null = currentRoom()) {
  const [me, setUser] = useState<SessionUser | null>(null);
  const [orgs, setOrgs] = useState<OrgSummary[]>([]);
  const [sessionReady, setSessionReady] = useState(false);
  const [access, setAccess] = useState<Access | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  /** The organisation this board belongs to; a legacy room has none. */
  const [boardOrgId, setBoardOrgId] = useState<string | undefined>(undefined);
  /** The board's server-side name, kept when a template seeds a new board. */
  const [boardIcon, setBoardIcon] = useState("");
  const [boardTeam, setBoardTeam] = useState<{ id: string; name: string }>();
  const [boardTitle, setBoardTitle] = useState<string | undefined>(undefined);
  const currentUser = useRef<SessionUser | null>(null);
  const identityEpoch = useRef(0);
  const accessSeq = useRef(0);
  const setMe = useCallback((next: SetStateAction<SessionUser | null>) => {
    const user = typeof next === "function" ? next(currentUser.current) : next;
    identityEpoch.current++;
    if (currentUser.current?.id !== user?.id) {
      accessSeq.current++;
      setAccess(null);
    }
    currentUser.current = user;
    setUser(user);
    setSessionReady(true);
  }, []);

  // A failure is not an error state: most visitors of a legacy room are anonymous.
  useEffect(() => {
    let alive = true;
    const epoch = identityEpoch.current;
    api
      .me()
      .then((result) => {
        if (!alive || epoch !== identityEpoch.current) return;
        setMe(result.user);
        setOrgs(result.orgs);
      })
      .catch(() => {
        if (!alive || epoch !== identityEpoch.current) return;
        setMe(null);
        setOrgs([]);
      });
    return () => {
      alive = false;
    };
  }, [setMe]);

  /** Re-read the organisation list after creating or renaming one (ADR-166). */
  const refreshOrgs = useCallback(async () => {
    try {
      const result = await api.me();
      setOrgs(result.orgs);
    } catch {
      // The next full sign-in or reload will try again; the current list stays usable.
    }
  }, []);

  /** Guards against a slow answer overwriting a newer access decision. */
  const retryAccess = useRef<number | null>(null);

  /** What this viewer may do with this board, straight from the server. */
  const refreshAccess = useCallback(async () => {
    if (!room) {
      setAccess(null);
      setBoardOrgId(undefined);
      setBoardIcon("");
      setBoardTeam(undefined);
      return;
    }
    const seq = ++accessSeq.current;
    try {
      const result = await api.access(room);
      if (seq !== accessSeq.current) return;
      // Another tab can replace the cookie. Refresh the displayed identity as well as
      // the grant, and reject an older in-flight answer after an explicit sign-in.
      if (result.access.principalId !== undefined && result.access.principalId !== (currentUser.current?.id ?? null)) {
        const owner = result.access.principalId;
        const identity = owner ? await api.me() : null;
        if (seq !== accessSeq.current || (identity?.user?.id ?? null) !== owner) return;
        setMe(identity?.user ?? null);
        setOrgs(identity?.orgs ?? []);
      }
      if (retryAccess.current) {
        window.clearTimeout(retryAccess.current);
        retryAccess.current = null;
      }
      setAccess(result.access);
      setBoardOrgId(result.board?.orgId);
      setBoardTitle(result.board?.title);
      setBoardTeam(result.board?.team);
      setBoardIcon(result.board?.icon ?? "");
    } catch (failure) {
      if (seq !== accessSeq.current) return;
      const status = failure instanceof ApiError ? failure.status : 0;
      const code = failure instanceof ApiError ? failure.code : "";
      // A network failure or a 5xx is not a decision. Keep the last one and retry;
      // showing "no access" would close the gate on a restarting server.
      if (status === 0 || status >= 500) {
        if (retryAccess.current) window.clearTimeout(retryAccess.current);
        retryAccess.current = window.setTimeout(() => void refreshAccess(), 2_000);
        return;
      }
      setBoardIcon("");
      setBoardTeam(undefined);
      setAccess({
        allowed: false,
        role: null,
        capabilities: [],
        sources: [],
        reason:
          code === "PASSWORD_REQUIRED"
            ? "PASSWORD_REQUIRED"
            : code === "LINK_INACTIVE"
              ? "LINK_INACTIVE"
              : status === 401
                ? "AUTH_REQUIRED"
                : "NOT_FOUND",
      });
    }
  }, [room, setMe]);

  useEffect(
    () => () => {
      if (retryAccess.current) window.clearTimeout(retryAccess.current);
    },
    [],
  );

  useEffect(() => {
    if (sessionReady) void refreshAccess();
  }, [refreshAccess, me?.id, sessionReady]);

  /**
   * The canvas leaves need one answer from this hook — the export right behind "Download
   * original" — and `BoardApp` is at the size ratchet, so the answer is published here
   * instead of drilled through it. The decision itself stays in this one place.
   */
  useEffect(() => {
    if (!room) return;
    publishAccess(room, access, orgs, boardOrgId);
  }, [room, access, orgs, boardOrgId]);

  const canShare = Boolean(access?.capabilities.includes("board.share"));
  const canExport = Boolean(access?.capabilities.includes("board.export"));
  const canBackup = Boolean(access?.capabilities.includes("board.backup"));
  // Import replaces the document and the discussion, so it is a management action; taking
  // a backup is not (ADR-161).
  const canImport = Boolean(access?.capabilities.includes("board.manage"));
  // AI is for an account that may edit. A public link is view-only: it has no account
  // behind the decision for an agent to act on behalf of (ADR-066, AG-12).
  const linkOnly = access?.sources?.length === 1 && access.sources[0] === "link";
  const canAskAgents = Boolean(
    me && boardOrgId && access?.allowed && !linkOnly && access.capabilities.includes("board.edit"),
  );
  const canFacilitate = Boolean(access?.capabilities.includes("board.facilitate"));
  const canManage = Boolean(access?.capabilities.includes("board.manage"));
  const canTransfer = Boolean(access?.capabilities.includes("board.transfer"));
  const denied = Boolean(access && !access.allowed);

  return {
    me,
    setMe,
    orgs,
    refreshOrgs,
    sessionReady,
    access,
    refreshAccess,
    boardOrgId,
    boardTeam, boardIcon,
    boardTitle,
    authOpen,
    setAuthOpen,
    canShare,
    canExport,
    canBackup,
    canImport,
    linkOnly,
    canAskAgents,
    canFacilitate,
    canManage,
    canTransfer,
    denied,
  };
}
