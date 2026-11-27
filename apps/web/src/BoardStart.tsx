import type { Widget } from "@remo/model";
import { BoardStateLayer } from "./BoardOverlays";

/**
 * The start-of-room states: blocked, empty, denied or unclaimed (ADR-197).
 *
 * `BoardApp` was at the 800-line limit when the first-visit path arrived. The facts and
 * the callbacks are grouped here so the app composes the room instead of repeating the
 * state layer's ten props inline.
 */
export function BoardStart({
  state,
  onCreateNote,
  onExample,
  onAskAgent,
  onInvite,
  onSignIn,
  onHome,
  onClaim,
}: {
  state: {
    blocked: boolean;
    offline: boolean;
    placing: boolean;
    widgets: readonly Widget[];
    denied: boolean;
    reason: string | null | undefined;
    signedIn: boolean;
    boardId: string;
    readOnly: boolean;
    synced: boolean;
    hasPeers: boolean;
  };
  onCreateNote: () => void;
  onExample: () => void;
  onAskAgent: (() => void) | null;
  onInvite: (() => void) | null;
  onSignIn: () => void;
  onHome: () => void;
  onClaim: () => void;
}) {
  return (
    <BoardStateLayer
      blocked={state.blocked}
      offline={state.offline}
      emptyRoom={!state.placing && !state.denied && state.widgets.length === 0 ? state.boardId : null}
      denied={state.denied}
      reason={state.reason}
      signedIn={state.signedIn}
      boardId={state.boardId}
      readOnly={state.readOnly}
      hasPeers={state.hasPeers}
      synced={state.synced}
      onCreateNote={onCreateNote}
      onExample={onExample}
      onAskAgent={onAskAgent}
      onInvite={onInvite}
      onSignIn={onSignIn}
      onHome={onHome}
      onClaim={onClaim}
    />
  );
}
