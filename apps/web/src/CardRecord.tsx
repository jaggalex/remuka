import { useEffect, useId, useState, type ReactNode } from "react";
import { setCardFields, setCardFill, type BoardDocument } from "@remo/doc";
import { FILL_LEVELS, TONE_LEVELS, type Tag, type CardStatus, type KanbanColumn, type Widget } from "@remo/model";
import { Input, Radio, Select } from "@remo/ui";
import { daysPastDue, todayIso } from "./cardFilter";
import { useI18n } from "./i18n";
import { ColorGridSection } from "./object-panel/ColorWindow";

interface CardProps {
  board: BoardDocument;
  card: Widget;
  disabled: boolean;
}

export function CardStatusBadge({ board, card, disabled }: CardProps) {
  const { t } = useI18n();
  return (
    <div className="card-status-badge" data-status={card.status ?? ""}>
      <Select aria-label={t("card.status")} size="compact" disabled={disabled}
        value={card.status ?? ""}
        options={[
          { value: "", label: t("card.noStatus") },
          { value: "todo", label: t("card.status.todo") },
          { value: "in_progress", label: t("card.status.in_progress") },
          { value: "done", label: t("card.status.done") },
        ]}
        onChange={event => setCardFields(board, card.id, { status: event.target.value as CardStatus || undefined })}
      />
    </div>
  );
}

/** An open inspector also crosses midnight or resumes after a sleeping tab. */
function useLocalDay() {
  const [day, setDay] = useState(() => todayIso());
  useEffect(() => {
    let timer: number;
    const sync = () => {
      window.clearTimeout(timer);
      const now = new Date();
      setDay(todayIso(now));
      const midnight = new Date(now);
      midnight.setHours(24, 0, 0, 0);
      timer = window.setTimeout(sync, midnight.getTime() - now.getTime());
    };
    sync();
    window.addEventListener("focus", sync);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", sync);
    };
  }, []);
  return day;
}

export function CardRecord({ board, card, people, disabled }: CardProps & {
  people: Array<{ id: string; name: string }>;
}) {
  const { t, lang } = useI18n();
  const assignees = card.assigneeId && !people.some(person => person.id === card.assigneeId)
    ? [...people, { id: card.assigneeId, name: card.assigneeName ?? card.assigneeId }]
    : people;
  const day = useLocalDay();
  const late = daysPastDue(card.dueAt, day);
  const overdueId = useId();
  return (
    <>
      <p className="card-record-title">{board.textOf(card.id).trim() || t("board.untitled")}</p>
      <Select label={t("card.assignee")} disabled={disabled} value={card.assigneeId ?? ""}
        options={[{ value: "", label: t("card.unassigned") }, ...assignees.map(person => ({ value: person.id, label: person.name }))]}
        onChange={event => {
          const person = assignees.find(entry => entry.id === event.target.value);
          setCardFields(board, card.id, { assigneeId: person?.id, assigneeName: person?.name });
        }}
      />
      <div className="card-dates">
        <Input label={t("card.start")} type="date" value={card.startAt ?? ""} disabled={disabled}
          onChange={event => setCardFields(board, card.id, { startAt: event.target.value || undefined })} />
        <div className={late ? "past-due" : undefined}>
          <Input label={t("card.due")} aria-details={late ? overdueId : undefined} type="date" value={card.dueAt ?? ""} disabled={disabled}
            onChange={event => setCardFields(board, card.id, { dueAt: event.target.value || undefined })} />
        </div>
      </div>
      {late > 0 && <p id={overdueId} className="card-overdue" role="status">
        {t("card.pastDue", { when: new Intl.RelativeTimeFormat(lang, { numeric: "auto" }).format(-late, "day") })}
      </p>}
    </>
  );
}

export function CardTags({ assigned, children }: { assigned: Tag[]; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <details className="rm-disclosure tags-fold card-tags">
      <summary>
        <span className="card-tags-label">{t("tags.title")}</span>
        {assigned.map(tag => <span key={tag.id} className={`tag-chip tag-${tag.color}`}>{tag.name}</span>)}
        <span className="card-tag-action">{t("card.editTags")}</span>
      </summary>
      <div className="rm-disclosure-body">{children}</div>
    </details>
  );
}

export function CardColour({ board, card, disabled, column }: CardProps & { column?: KanbanColumn }) {
  const { t } = useI18n();
  const group = useId();
  const own = card.style?.fillColor;
  const custom = own || TONE_LEVELS.pink[300];
  return (
    <fieldset className="card-colour" disabled={disabled}>
      <legend>{t("menu.cardColour")}</legend>
      <Radio name={group} label={column ? t("menu.likeColumn") : t("sticky.auto")}
        checked={!own} onChange={() => setCardFill(board, card.id, null)} />
      <Radio name={group} label={<>{t("color.own")} <span aria-hidden="true" className="card-colour-sample" style={{ backgroundColor: custom }} /></>}
        checked={Boolean(own)} onChange={() => setCardFill(board, card.id, custom)} />
      {own && <ColorGridSection ariaLabel={t("menu.cardColour")} levels={FILL_LEVELS} value={own}
        onPick={colour => setCardFill(board, card.id, colour)} />}
    </fieldset>
  );
}
