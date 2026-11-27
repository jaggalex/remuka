import { useEffect, useState } from "react";

export type RoomConnectionNotice = {
  kind: "session" | "access" | "full" | "moved";
  text: string;
  action?: { label: string; run: () => void };
};

export type BoardNotice = string | RoomConnectionNotice;

/**
 * A transient line under the canvas ("the connector limit is 32").
 *
 * The timer belongs to the message, not to App: every caller only shows a sentence, and
 * the message clears itself. Keeping it here is why App can stay a controller (ADR-093).
 */
export function useNotice(milliseconds = 4000) {
  const [notice, setNotice] = useState<BoardNotice | null>(null);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), milliseconds);
    return () => window.clearTimeout(timer);
  }, [notice, milliseconds]);

  return { notice, showNotice: setNotice };
}
