import { Link } from "@remo/ui";
import { useI18n } from "./i18n";
import { hintDefaults } from "./hintSlots";
import { actedOnHint } from "./hintCatalog";
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
 * Room headings rotate independently of the instructional plate (ADR-268).
 */
export function EmptyRoomStart({
  readOnly,
  hasPeers,
  synced,
  onCreateNote,
  onExample,
  onAskAgent,
  onInvite,
}: {
  readOnly: boolean;
  hasPeers: boolean;
  synced: boolean;
  onCreateNote: () => void;
  onExample: () => void;
  /** Null when this organisation has no agent to ask (the card is not promised). */
  onAskAgent: (() => void) | null;
  /** Null when the viewer may not invite (a guest, a reader). */
  onInvite: (() => void) | null;
}) {
  const { t, lang, hints } = useI18n();
  const proposal = useProposal();
  const active = synced && !readOnly && !proposal;
  const { show, variant: plate } = useOnceHint("canvas.doubleClickEdit", { active });
  const { variant: heading } = useOnceHint("room.empty", { active, canInvite: Boolean(onInvite), hasPeers });
  const [before, mark] = (!readOnly && heading.title) || ["empty.titleBefore", "empty.titleMark"];
  const benefit = hints["room.empty"]?.find(item => item.key === "benefit")?.fields.body;
  const needsTemplateAlternative = !onAskAgent && (!benefit || benefit === hintDefaults["empty.benefitBody"][lang]);
  const body = readOnly ? "empty.readOnly" :
    heading.intent === "benefit" && needsTemplateAlternative ? "empty.benefitTemplate" : heading.key;
  const emphasis = readOnly ? hintDefaults["empty.titleMark"][lang] : t(mark);
  if (proposal) return null;

  return (
    <div className="empty-board">
      <div className="empty-artwork">
        <div className="empty-illustration" aria-hidden="true">
          <span className="empty-shape is-circle" />
          <span className="empty-shape is-square" />
          <span className="empty-shape is-smile" />
        </div>
        {!readOnly && show && (
          <span className="empty-legend" role="status">
            {t(plate.key)}
          </span>
        )}
      </div>

      <div className="empty-heading">
        <h1>
          {readOnly ? hintDefaults["empty.titleBefore"][lang] : t(before)}{" "}
          {emphasis && <span className="empty-mark">
            <svg viewBox="0 0 300 30" preserveAspectRatio="none" aria-hidden="true">
              <path d="M4 20 C 60 6, 140 4, 296 14 L 294 26 C 170 18, 80 20, 6 28 Z" />
            </svg>
            <span className="empty-mark-text">{emphasis}</span>
          </span>}
        </h1>
        <p>{t(body)}</p>
      </div>

      {!readOnly && (
        <div className="empty-cards">
          <button type="button" className="empty-card" onClick={() => { actedOnHint("room.empty"); onCreateNote(); }}>
            <span className="empty-card-icon is-note" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round">
                <path d="M4 4h16v11l-5 5H4z" />
                <path d="M15 20v-5h5" />
              </svg>
            </span>
            <strong>{t("empty.noteTitle")}</strong>
            <span className="muted">{t("empty.noteBody")}</span>
          </button>

          <button type="button" className="empty-card" onClick={() => { actedOnHint("room.empty"); onExample(); }}>
            <span className="empty-card-icon is-template" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="M4 5h7v6H4zM13 5h7v6h-7zM4 13h7v6H4zM13 13h7v6h-7z" />
              </svg>
            </span>
            <strong>{t("empty.templateTitle")}</strong>
            <span className="muted">{t("empty.templateBody")}</span>
          </button>

          {onAskAgent && (
            <button type="button" className="empty-card is-agent" onClick={() => { actedOnHint("room.empty"); onAskAgent(); }}>
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
              actedOnHint("room.empty");
              onInvite();
            }}
          >
            {t("empty.togetherLink")}
          </Link>{" "}
          {t("empty.togetherAfter")}
        </p>
      )}
    </div>
  );
}
