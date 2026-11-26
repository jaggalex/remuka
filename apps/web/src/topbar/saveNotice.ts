import { useEffect, useRef, useState } from "react";
import type { SaveState } from "@remo/doc";
import { useNow } from "../useNow";

/**
 * What the header shows about saving (ADR-266 §3).
 *
 * Saved is silence. A short wait is silence too: "Saving…" appears only once the
 * acknowledgement is later than two seconds, so ordinary typing never flashes a
 * status. Offline and a stopped queue appear at once, because they change what the
 * person may do next. Coming back from offline says "Saved" for two seconds.
 *
 * The rules live in a pure function so the timing is tested without a browser.
 */
export type SaveNoticeKind = "none" | "saving" | "saved" | "offline" | "blocked";

/** An ordinary ack is faster than this; a longer wait is worth a word. */
export const SAVE_SLOW_AFTER_MS = 2_000;
/** "Saved" stays just long enough to be read, then the header is quiet again. */
export const SAVE_DONE_FOR_MS = 2_000;

export function saveNoticeKind({
  state,
  blocked,
  pendingMs,
  savedMs,
}: {
  state: SaveState["state"];
  blocked: boolean;
  /** How long the current edit has waited, or null when nothing waits. */
  pendingMs: number | null;
  /** How long ago the room returned from offline, or null when it did not. */
  savedMs: number | null;
}): SaveNoticeKind {
  if (blocked) return "blocked";
  if (state === "offline") return "offline";
  if (state === "saved") {
    return savedMs != null && savedMs < SAVE_DONE_FOR_MS ? "saved" : "none";
  }
  if (state === "pending" || state === "connecting") {
    return pendingMs != null && pendingMs >= SAVE_SLOW_AFTER_MS ? "saving" : "none";
  }
  return "none";
}

/**
 * The live notice, with the two clocks the table needs.
 *
 * `savedAt` is set only on the transition out of offline, not on every ack: "All
 * saved" is an answer to a lost connection, not a trophy for typing.
 */
export function useSaveNotice(save: SaveState): SaveNoticeKind {
  const [pendingSince, setPendingSince] = useState<number | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const wasOffline = useRef(false);

  useEffect(() => {
    if (save.state === "pending" || save.state === "connecting") {
      setPendingSince((current) => current ?? Date.now());
    } else {
      setPendingSince(null);
    }
    if (save.state === "offline") wasOffline.current = true;
    if (save.state === "saved" && wasOffline.current) {
      wasOffline.current = false;
      setSavedAt(Date.now());
    }
  }, [save.state]);

  useEffect(() => {
    if (savedAt == null) return;
    const timer = window.setTimeout(() => setSavedAt(null), SAVE_DONE_FOR_MS);
    return () => window.clearTimeout(timer);
  }, [savedAt]);

  const active = pendingSince != null || savedAt != null;
  const now = useNow(active, `${save.state}:${savedAt ?? ""}:${pendingSince ?? ""}`, 250);

  return saveNoticeKind({
    state: save.state,
    blocked: save.blocked,
    pendingMs: pendingSince == null ? null : Math.max(0, now - pendingSince),
    savedMs: savedAt == null ? null : Math.max(0, now - savedAt),
  });
}
