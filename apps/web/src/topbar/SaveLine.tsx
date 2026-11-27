import { ReadOnlyBadge } from "@remo/ui";
import type { SaveState } from "@remo/doc";
import { useI18n } from "../i18n";
import type { TranslationKey } from "../i18n";
import { useSaveNotice, type SaveNoticeKind } from "./saveNotice";

const TEXT: Record<Exclude<SaveNoticeKind, "none">, TranslationKey> = {
  saving: "sync.pending",
  saved: "sync.saved",
  offline: "sync.offline",
  blocked: "sync.blockedChip",
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
  // The offline banner announces the transition once. The visible chip can then
  // count each queued update without making a screen reader announce every keystroke.
  const live = kind === "saved" ? t(TEXT.saved) : "";
  const showCount = kind === "offline" && (!readOnly || saveState.pending > 0);
  const label = showCount ? t("sync.offlineCount", { n: saveState.pending }) : kind !== "none" ? t(TEXT[kind]) : "";
  return (
    <div className="topbar-save">
      {readOnly && <ReadOnlyBadge />}
      <span
        className={kind === "none" ? "save-state" : `save-state is-${kind}`}
        data-state={saveState.state}
        data-pending={saveState.pending}
      >
        {kind !== "none" && <span className="save-state-text">{label}</span>}
      </span>
      <span className="rm-visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {live}
      </span>
    </div>
  );
}
