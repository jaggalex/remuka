import { useEffect, useState } from "react";
import { type TemplateKey } from "@remo/model";
import { Button, Dialog, Disclosure, Input, Select } from "@remo/ui";
import { api, ApiError, type OrgSummary } from "./api";
import { planLimitFrom, type PlanLimitNotice } from "./apiBilling";
import { PlanNotice } from "./PlanNotice";
import { useI18n } from "./i18n";
import { HelpLink } from "./help/HelpLink";
import { RoomTemplateChoices } from "./RoomTemplateChoices";
import "./styles/new-room.css";

/** A template choice is one of the four authored templates plus an empty board. */
type Choice = "empty" | TemplateKey;

/**
 * Create a board from the board list.
 *
 * The server owns the decision (`board.create`, ADR-100); this dialog only asks for a
 * name, a team and a starting point. The new room is opened with `?template=`, and the
 * document seeds itself once sync has confirmed it is empty.
 */
export function NewBoardDialog({
  open,
  orgs,
  defaultOrgId = null,
  initialTemplate = "empty",
  onOpenBilling,
  onClose,
  onCreated,
}: {
  open: boolean;
  orgs: OrgSummary[];
  /** The directory filter, so a new board starts in the organisation being viewed. */
  defaultOrgId?: string | null;
  /** The home's example link preselects an authored template; the default is empty. */
  initialTemplate?: "empty" | TemplateKey;
  /** A `402` offers the plan screen; the home owns the one organisation dialog. */
  onOpenBilling?: (orgId: string) => void;
  onClose: () => void;
  onCreated: (boardId: string, template: Choice, title: string) => void;
}) {
  const { t } = useI18n();
  const [title, setTitle] = useState("");
  const [orgId, setOrgId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [teams, setTeams] = useState<Array<{ id: string; name: string }>>([]);
  const [template, setTemplate] = useState<Choice>("empty");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [planLimit, setPlanLimit] = useState<PlanLimitNotice | null>(null);

  const canCreate = orgs.filter((org) => org.capabilities?.includes("board.create"));

  useEffect(() => {
    if (!open) return;
    setTouched(false);
    setTitle("");
    setTemplate(initialTemplate);
    setError(null);
    setPlanLimit(null);
    setTeamId("");
    setTeams([]);
    const preferred = canCreate.find((org) => org.id === defaultOrgId) ?? canCreate[0];
    setOrgId(preferred?.id ?? "");
  }, [open, defaultOrgId, initialTemplate]);

  // Teams are per organisation; reload them when the selection changes.
  useEffect(() => {
    if (!open || !orgId) return;
    let alive = true;
    api
      .teams(orgId)
      .then((result) => {
        if (!alive) return;
        setTeams(result.teams);
        setTeamId(result.teams[0]?.id ?? "");
      })
      .catch(() => {
        if (alive) setTeams([]);
      });
    return () => {
      alive = false;
    };
  }, [open, orgId]);

  if (!open) return null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (busy || !orgId || !title.trim()) return;
    setBusy(true);
    setError(null);
    setPlanLimit(null);
    try {
      const created = await api.createBoard(orgId, {
        title: title.trim(),
        ...(teamId ? { teamId } : {}),
      });
      onCreated(created.board.id, template, title.trim());
    } catch (failure) {
      // A plan refusal is not a failed form: it names the limit and offers the plan screen.
      const notice = planLimitFrom(failure);
      if (notice) {
        setPlanLimit(notice);
        return;
      }
      const code = failure instanceof ApiError ? failure.code : "";
      setError(
        code === "BOARD_CREATE_FORBIDDEN"
          ? t("newBoard.forbidden")
          : code === "TEAM_REQUIRED"
            ? t("newBoard.teamRequired")
            : code === "ORG_NAME_REQUIRED"
              ? t("newBoard.titleRequired")
              : t("newBoard.failed"),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={t("newBoard.title")}
      help={<HelpLink topicId="rooms.create" />}
      size="lg"
      className="new-room-sheet"
      description={t("newBoard.intro")}
      onClose={onClose}
      dismissable={!busy}
    >
      <form className="dialog-stack new-board-dialog" onSubmit={submit} noValidate>
        <Input
          label={t("newBoard.name")}
            autoFocus
            required
            maxLength={120}
            value={title}
            placeholder={t("newBoard.namePlaceholder")}
            error={touched && !title.trim() ? t("newBoard.titleRequired") : undefined}
            onChange={(event) => { setTouched(true); setTitle(event.target.value); }}
          />

        <RoomTemplateChoices value={template} onChange={setTemplate} />
        <Disclosure label={t("newBoard.place")} value={[
          canCreate.find(org => org.id === orgId)?.name, teams.find(team => team.id === teamId)?.name,
        ].filter(Boolean).join(" · ")}>
          <Select label={t("newBoard.org")} value={orgId}
            options={canCreate.map(org => ({ value: org.id, label: org.name }))}
            onChange={event => { setTeamId(""); setTeams([]); setOrgId(event.currentTarget.value); }} />
          <Select label={t("newBoard.team")} value={teamId}
            options={teams.map(team => ({ value: team.id, label: team.name }))}
            onChange={event => setTeamId(event.currentTarget.value)} />
        </Disclosure>

        {error && <p className="auth-error">{error}</p>}
        {planLimit && (
          <PlanNotice
            orgId={orgId}
            notice={planLimit}
            onSeePlans={onOpenBilling ? () => onOpenBilling(orgId) : undefined}
            onDismiss={() => setPlanLimit(null)}
          />
        )}

        <div className="auth-actions">
          <Button disabled={busy} onClick={onClose}>
            {t("newBoard.cancel")}
          </Button>
          <Button type="submit" variant="primary" disabled={busy || !orgId || !title.trim()}>
            {busy ? t("newBoard.creating") : t("newBoard.create")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
