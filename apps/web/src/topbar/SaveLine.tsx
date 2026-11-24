import { ReadOnlyBadge } from "@remo/ui";
import type { SaveState } from "@remo/doc";
import { useI18n } from "../i18n";
import type { TranslationKey } from "../i18n";
import { useSaveNotice, type SaveNoticeKind } from "./saveNotice";

const TEXT: Record<Exclude<SaveNoticeKind, "none">, TranslationKey> = {
  saving: "sync.pending",
  saved: "sync.saved",
  offline: "sync.offline",
  blocked: "sync.blocked",
};

/**
 * Saving, next to the room's name (ADR-266 §3).
 *
 * There is no permanent cloud and no help icon: silence is the normal state. The
 * element with `data-state` stays in the DOM, visually empty, because scenarios read
 * the protocol rather than a word that is no longer always on screen.
 */
export function SaveLine({
  saveState,
  readOnly,
}: {
  saveState: SaveState;
  readOnly: boolean;
}) {
  const { t } = useI18n();
  const kind = useSaveNotice(saveState);
  // Pending is not announced: a screen reader should not narrate every keystroke.
  // Offline, a stopped queue and the return to saved are announcements.
  const live: string =
    kind === "offline" || kind === "blocked" || kind === "saved" ? t(TEXT[kind]) : "";

  return (
    <div className="topbar-save">
      {readOnly && <ReadOnlyBadge />}
      <span
        className={kind === "none" ? "save-state" : `save-state is-${kind}`}
        data-state={saveState.state}
        data-pending={saveState.pending}
      >
        {kind !== "none" && <span className="save-state-text">{t(TEXT[kind])}</span>}
      </span>
      <span className="rm-visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {live}
      </span>
    </div>
  );
}
