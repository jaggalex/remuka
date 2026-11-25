import { Link } from "@remo/ui";
import { useI18n } from "./i18n";
import { useOnceHint } from "./useOnceHint";
import { useProposal } from "./proposalStore";

/**
 * The empty room: the first screen of a new room (ADR-197, mockup App-EmptyRoom).
 *
 * Three ways in, all existing mechanisms: a sticker, a template picker, the agent. A
 * reader without write access sees the same picture and no actions. The legend on the
 * left is the one-time hint registry (ADR-266 §6): it disappears after the double click is
 * learned, and "Show hints again" brings it back; no second hint store.
 *
 * The three variants of the mockup are T13. This is variant one in the final structure.
 */
export function EmptyRoomStart({
  readOnly,
  onCreateNote,
  onExample,
  onAskAgent,
  onInvite,
}: {
  readOnly: boolean;
  onCreateNote: () => void;
  onExample: () => void;
  /** Null when this organisation has no agent to ask (the card is not promised). */
  onAskAgent: (() => void) | null;
  /** Null when the viewer may not invite (a guest, a reader). */
  onInvite: (() => void) | null;
}) {
  const { t } = useI18n();
  const { show, definition } = useOnceHint("canvas.doubleClickEdit", { active: !readOnly });
  if (useProposal()) return null;

  return (
    <div className="empty-board">
      <div className="empty-illustration" aria-hidden="true">
        <span className="empty-shape is-circle" />
        <span className="empty-shape is-square" />
        <span className="empty-shape is-smile" />
      </div>

      <div className="empty-heading">
        <h1>
          {t("empty.titleBefore")}{" "}
          <span className="empty-mark">
            <svg viewBox="0 0 300 30" preserveAspectRatio="none" aria-hidden="true">
              <path d="M4 20 C 60 6, 140 4, 296 14 L 294 26 C 170 18, 80 20, 6 28 Z" />
            </svg>
            <span className="empty-mark-text">{t("empty.titleMark")}</span>
          </span>
        </h1>
        <p>{readOnly ? t("empty.readOnly") : t("empty.body")}</p>
      </div>

      {!readOnly && (
        <div className="empty-cards">
          <button type="button" className="empty-card" onClick={() => onCreateNote()}>
            <span className="empty-card-icon is-note" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round">
                <path d="M4 4h16v11l-5 5H4z" />
                <path d="M15 20v-5h5" />
              </svg>
            </span>
            <strong>{t("empty.noteTitle")}</strong>
            <span className="muted">{t("empty.noteBody")}</span>
          </button>

          <button type="button" className="empty-card" onClick={() => onExample()}>
            <span className="empty-card-icon is-template" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="M4 5h7v6H4zM13 5h7v6h-7zM4 13h7v6H4zM13 13h7v6h-7z" />
              </svg>
            </span>
            <strong>{t("empty.templateTitle")}</strong>
            <span className="muted">{t("empty.templateBody")}</span>
          </button>

          {onAskAgent && (
            <button type="button" className="empty-card is-agent" onClick={() => onAskAgent()}>
              <span className="empty-card-icon is-agent" aria-hidden="true">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                  <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6" />
                </svg>
              </span>
              <strong>{t("empty.agentTitle")}</strong>
              <span className="muted">{t("empty.agentBody")}</span>
            </button>
          )}
        </div>
      )}

      {!readOnly && onInvite && (
        <p className="empty-together">
          {t("empty.togetherBefore")}{" "}
          <Link
            href="#invite"
            onClick={(event) => {
              event.preventDefault();
              onInvite();
            }}
          >
            {t("empty.togetherLink")}
          </Link>{" "}
          {t("empty.togetherAfter")}
        </p>
      )}

      {!readOnly && show && (
        <span className="empty-legend" role="status">
          {t(definition.text)}
        </span>
      )}
    </div>
  );
}
