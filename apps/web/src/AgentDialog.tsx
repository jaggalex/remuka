import { resolveSkill } from "@remo/agent-plan/skill-choice";
import { PLAN_LIMITS } from "@remo/agent-plan";
import { homeAction } from "./homeAction";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentPlan, AppliedAgentPlan, BoardDocument } from "@remo/doc";
import type { Widget } from "@remo/model";
import { api, type BoardAgents, type ChangeSet } from "./api";
import { cameraStore } from "./cameraStore";
import { AgentTaskHistory } from "./AgentTaskHistory";
import { AgentFileField } from "./AgentFileField";
import { AgentPlanPanel } from "./AgentPlanPanel";
import type { TaskFile } from "./agentFile";
import { agentFailureText, taskFailureText } from "./agentError";
import { agentPayload } from "./agentPayload";
import { AgentSelectionSource } from "./AgentSelectionSource";
import { AUTO_SKILL, compatibleSkills } from "./agentSkills";
import { skillDescriptionKey, skillNameKey } from "./skillText";
import { formatMoment } from "./format";
import { newIdempotencyKey } from "./idempotency";
import { HelpLink } from "./help/HelpLink";
import { Button, Dialog, Input, Select, Switch, Textarea, Radio, IconButton } from "@remo/ui";
import { useI18n } from "./i18n";

/**
 * Agents on one board: allow them, ask one for a diagram, see what happened.
 *
 * The dialog never talks to the model: it queues a task, the service runs it, and the
 * canvas updates through Yjs like any other edit. Writing is a board decision
 * (`board.manage`), running a task needs `board.edit`.
 */
export function AgentDialog({
  board,
  open,
  roomTags,
  initialIntent = "",
  boardId,
  boardTitle,
  canManage,
  canEdit,
  selectionIds,
  widgets,
  onApplyPlan,
  onClose,
  onOpenOrg,
}: {
  board: BoardDocument;
  open: boolean;
  roomTags: React.ReactNode;
  /** A task the command search already typed for the person (T7). */
  initialIntent?: string;
  boardId: string;
  boardTitle: string;
  canManage: boolean;
  canEdit: boolean;
  /** Objects selected on the board: the source for the cards skill and context for diagrams. */
  selectionIds: string[];
  /** The board snapshot, so the dialog can show exactly which fragments leave for the model. */
  widgets: Widget[];
  /** Apply an approved plan to the live document; the app owns the board and selection. */
  onApplyPlan: (
    plan: AgentPlan,
    provenance: Widget["agent"],
    options?: { allowedIds?: string[] },
  ) => AppliedAgentPlan;
  onClose: () => void;
  onOpenOrg: () => void;
}) {
  const { t, lang } = useI18n();
  const [data, setData] = useState<BoardAgents | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agentId, setAgentId] = useState("");
  const [intent, setIntent] = useState("");
  const [maxActions, setMaxActions] = useState(20);
  const [maxCostUsd, setMaxCostUsd] = useState(0.5);
  const [repeat, setRepeat] = useState<"once" | "hourly" | "daily" | "weekly">("once");
  const [skillSlug, setSkillSlug] = useState("");
  const [targetKind, setTargetKind] = useState<"standalone" | "kanban">("standalone");
  const [mode, setMode] = useState<"copy" | "move">("copy");
  const [dismissedTask, setDismissedTask] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const intentField = useRef<HTMLTextAreaElement>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [jobPreview, setJobPreview] = useState<{ id: string; cards: number } | null>(null);
  const [changeSets, setChangeSets] = useState<ChangeSet[]>([]);
  const [file, setFile] = useState<TaskFile | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [newsTarget] = useState(() => homeAction("agent"));
  const [planTaskId, setPlanTaskId] = useState<string | null>(null);
  /** One key per unchanged draft, reused after a failed request (ADR-155). */
  const pendingKey = useRef<{ fingerprint: string; key: string } | null>(null);
  /**
   * The source the task will carry. The board selection is the default, but it can be
   * removed here without changing what is selected: a person may want the task alone
   * (ADR-143). "Only selection" fills the task from the selection and marks it.
   */
  const [sourceIds, setSourceIds] = useState<string[]>(() => [...selectionIds]);
  const [selectionOnly, setSelectionOnly] = useState(false);
  /** Plans already opened once: polling must not reopen a preview the person closed. */
  const openedPlans = useRef(new Set<string>());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [next, sets] = await Promise.all([
        api.boardAgents(boardId),
        api.boardChangeSets(boardId).catch(() => ({ changeSets: [] as ChangeSet[] })),
      ]);
      setData(next);
      setChangeSets(sets.changeSets);
      setAgentId((current) =>
        next.agents.some((agent) => agent.id === current) ? current : (next.agents[0]?.id ?? ""),
      );
      setSkillSlug((current) => {
        if (next.skills.some((skill) => skill.slug === current)) return current;
        // The plan skill is the default because "arrange this brief" is the common
        // request and it writes nothing until the person approves. The diagram skill
        // stays in the list for an immediate draw.
        return (
          next.skills.find((skill) => skill.slug === "brief-to-board")?.slug ??
          next.skills.find((skill) => skill.slug === "diagram")?.slug ??
          next.skills[0]?.slug ??
          ""
        );
      });
      setError(null);
    } catch (failure) {
      setError(agentFailureText(failure, t));
    } finally {
      setLoading(false);
    }
  }, [boardId, t]);

  useEffect(() => {
    if (!open) {
      // The plan belongs to the open dialog: reopening must start from the task list,
      // not from a preview the person already left (an applied one would return).
      setPlanTaskId(null);
      return;
    }
    setNotice(null);
    setSettingsOpen(false);
    setJobPreview(null);
    setFile(null);
    setFileError(null);
    setSelectionOnly(false);
    setSourceIds([...selectionIds]);
    void load();
  }, [open, load, selectionIds.join(",")]);

  // The search's last line opens the dialog with its words already in the field; the
  // person still presses the button, so nothing runs by itself (ADR-266 §1.2).
  useEffect(() => {
    if (open && initialIntent) setIntent(initialIntent);
  }, [open, initialIntent]);

  // A finished brief becomes a preview by itself. The person still decides: no plan
  // reaches the board without the Apply button (ADR-142).
  useEffect(() => {
    if (!open || planTaskId) return;
    const pending = (data?.tasks ?? []).filter(task => task.status === "awaiting_approval" && !openedPlans.current.has(task.id));
    const ready = newsTarget ? pending.find(task => task.id === newsTarget) : pending[0];
    if (!ready) return;
    openedPlans.current.add(ready.id);
    setPlanTaskId(ready.id);
  }, [open, data, planTaskId, newsTarget]);

  useEffect(() => {
    setJobPreview(null);
  }, [agentId, skillSlug, targetKind, mode, intent, maxActions, maxCostUsd, sourceIds.join(",")]);

  // Poll while the service is working: the document itself arrives over the socket.
  useEffect(() => {
    if (!open || !data) return;
    const working =
      data.tasks.some((task) => task.status === "queued" || task.status === "running") ||
      changeSets.some((set) => set.status === "queued" || set.status === "running");
    if (!working) return;
    const timer = window.setInterval(() => void load(), 2000);
    return () => window.clearInterval(timer);
  }, [open, data, changeSets, load]);

  // The snapshot identity changes whenever the shared document does. Read the
  // live Y.Doc with the exact extraction functions used by the agent runner.
  const context = useMemo(() => {
    return open ? agentPayload(board, sourceIds) : null;
  }, [open, board, widgets, sourceIds]);
  const hasSelection = sourceIds.length > 0;
  const skills = useMemo(
    () => compatibleSkills(data?.skills ?? [], { hasSelection }),
    [data?.skills, hasSelection],
  );
  const selectedSkill = skills.find((s) => s.slug === skillSlug) ?? null, selectedDescriptionKey = selectedSkill && skillDescriptionKey(selectedSkill.slug);

  // A hidden skill cannot stay chosen: removing the selection must not leave the form
  // pointing at "cards" or "tidy" with nothing to act on.
  useEffect(() => {
    if (!skillSlug) return;
    if (!skills.some((skill) => skill.slug === skillSlug)) setSkillSlug(AUTO_SKILL);
  }, [skillSlug, skills]);

  const isBrief = skillSlug === "brief-to-board" || skillSlug === AUTO_SKILL;

  const modelSkill = resolveSkill(data?.skills ?? [], { slug: skillSlug, intent })?.slug ?? "diagram";
  // A budget is an agreement, not a default: with no limit there is nothing to agree on.
  const budgetReady = Number.isFinite(maxActions) && maxActions >= 1;

  if (!context) return null;
  const snapshotTotal = context.snapshot.counts.objects;
  const snapshotSent = context.snapshot.counts.described;
  const modelObjects = modelSkill === "diagram" ? context.diagram
    : modelSkill === "tidy-selection"
      ? context.selection.objects.map((item) => ({...item, text: item.text.slice(0, PLAN_LIMITS.textLength)}))
      : context.selection.objects;

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
    } catch (failure) {
      setError(agentFailureText(failure, t));
    } finally {
      setBusy(false);
    }
  };

  const submit = () => {
    if (!agentId || !intent.trim()) return;
    const budget = { maxActions, maxCostUsd };
    const fingerprint = JSON.stringify({
      agentId,
      intent: intent.trim(),
      skillSlug,
      repeat,
      targetKind,
      mode,
      sourceIds,
      file: file ? { name: file.name, content: file.content } : null,
      budget,
    });
    if (pendingKey.current?.fingerprint !== fingerprint) {
      pendingKey.current = { fingerprint, key: newIdempotencyKey() };
    }
    const idempotencyKey = pendingKey.current.key;
    void run(async () => {
      const camera = cameraStore.get();
      const origin = { x: camera.x, y: camera.y };
      if (repeat === "once") {
        if (isCards) {
          if (jobPreview) {
            await api.executeChangeSet(jobPreview.id);
            setJobPreview(null);
            setNotice(t("agents.queued"));
            setIntent("");
          } else {
            const created = await api.createChangeSet(boardId, {
              agentId,
              intent: intent.trim(),
              origin,
              budget,
              preview: true,
              operations: [
                {
                  op: "create_cards",
                  selectionIds: sourceIds,
                  target: { kind: targetKind },
                  mode,
                },
              ],
            }, idempotencyKey);
            pendingKey.current = null;
            const cards = created.changeSet.estimate?.cards ?? 0;
            setJobPreview({ id: created.changeSet.id, cards });
            setNotice(t("agents.previewReady", { n: cards }));
          }
        } else {
          const created = await api.createAgentTask(boardId, {
            agentId,
            intent: intent.trim(),
            skillSlug: skillSlug || undefined,
            origin,
            budget,
            selectionIds: sourceIds,
            target: { kind: targetKind },
            mode,
            ...(isBrief && file
              ? { file: { name: file.name, content: file.content } }
              : {}),
          }, idempotencyKey);
          pendingKey.current = null;
          setNotice(
            created.task.input?.file?.truncated
              ? t("agents.file.truncatedNotice")
              : isBrief
                ? t("agents.queuedPlan")
                : t("agents.queued"),
          );
          setIntent("");
          setFile(null);
          setFileError(null);
        }
      } else {
        const hours = repeat === "hourly" ? 1 : repeat === "daily" ? 24 : 168;
        await api.createAgentSchedule(boardId, {
          agentId,
          intent: intent.trim(),
          intervalSeconds: hours * 3600,
          origin,
          budget,
        });
        pendingKey.current = null;
        setNotice(t("agents.scheduled"));
        setIntent("");
      }
    });
  };

  const ready = data?.orgEnabled && data.enabled;
  const isCards = skillSlug === "cards";
  const cardsBlocked = isCards && !hasSelection;
  const tasks = data?.tasks ?? [];
  const latest = tasks[0];
  const phaseTask = latest && !intent && latest.id !== dismissedTask &&
    ["queued", "running", "failed"].includes(latest.status) ? latest : null;
  const startAnother = () => {
    if (phaseTask) {
      setDismissedTask(phaseTask.id);
      if (phaseTask.status === "failed") setIntent(phaseTask.intent);
    }
    requestAnimationFrame(() => intentField.current?.focus());
  };

  const agent = data?.agents.find((entry) => entry.id === (phaseTask?.agent_id ?? agentId));
  const identity = agent?.owner_name ? t("agents.panel.identity", {agent: agent.name, name: agent.owner_name}) : agent?.name;
  const earlierTasks = tasks.filter((task) => task.id !== (planTaskId ?? phaseTask?.id));
  const history = <AgentTaskHistory tasks={earlierTasks} busy={busy} onPlan={setPlanTaskId}
    onCancel={(id) => void run(() => api.cancelAgentTask(id))} />;
  if (planTaskId) {
    return (
      <AgentPlanPanel
        roomTags={roomTags}
        key={planTaskId}
        taskId={planTaskId}
        history={history}
        agentOwnerName={data?.agents.find((entry) => entry.id === tasks.find((task) => task.id === planTaskId)?.agent_id)?.owner_name}
        onNewTask={() => { setPlanTaskId(null); setIntent(""); requestAnimationFrame(() => intentField.current?.focus()); }}
        canEdit={canEdit}
        undoManager={board.undo}
        onApply={onApplyPlan}
        onClose={() => setPlanTaskId(null)}
        onShowOnBoard={() => {
          setPlanTaskId(null);
          onClose();
        }}
        onApplied={() => {
          void load();
        }}
      />
    );
  }

  return (
    <Dialog
      className="room-agent-sheet agent-task-sheet"
      title={t(!phaseTask ? "agents.panel.new" : phaseTask.status === "failed" ? "agents.panel.error" : "agents.phase.running")}
      description={identity ?? boardTitle}
      help={<>
        <IconButton icon="more" label={t("agents.panel.settings")} size="compact"
          aria-expanded={Boolean(settingsOpen || !ready)} onClick={() => setSettingsOpen(!settingsOpen)} />
        <HelpLink topicId="agents.task" />
      </>}
      size="md"
      onClose={onClose}
    >
      <section className="agent-dialog">

        {error && (
          <div className="agent-error">
            <p className="auth-error">{error}</p>
            <div className="agent-error-actions">
              <Button size="compact" onClick={() => void load()} disabled={loading}>
                {t("agents.retry")}
              </Button>
              <Button variant="ghost" size="compact" onClick={onOpenOrg}>
                {t("agents.configure")}
              </Button>
            </div>
          </div>
        )}

        {data && (
          <>
            {(settingsOpen || !ready) && <div className="agent-enable">
              <Switch
                label={t("agents.boardSwitch")}
                checked={data.enabled}
                disabled={!canManage || busy}
                onChange={(event) => {
                  const next = event.target.checked;
                  void run(() => api.setBoardAgents(boardId, next));
                }}
              />
              {!data.orgEnabled && (
                <p className="muted">
                  {t("agents.orgOff")}{" "}
                  <Button variant="ghost" size="compact" onClick={onOpenOrg}>
                    {t("agents.openOrg")}
                  </Button>
                </p>
              )}
              {ready && data.agents.length > 0 && (
                <>
                    <Select
                      label={t("agents.choose")}
                      options={[
                        ...data.agents.map((agent) => ({ value: agent.id, label: agent.name })),
                      ]}
                      value={agentId}
                      onChange={(event) => setAgentId(event.target.value)}
                      disabled={!canEdit}
                    />
                      <Select
                        label={t("agents.repeat")}
                        options={[
                          { value: "once", label: t("agents.once") },
                          { value: "hourly", label: t("agents.hourly") },
                          { value: "daily", label: t("agents.daily") },
                          { value: "weekly", label: t("agents.weekly") },
                        ]}
                        value={repeat}
                        onChange={(event) => setRepeat(event.target.value as typeof repeat)}
                        disabled={!canEdit}
                      />
                  {phaseTask && phaseTask.status !== "failed" && canEdit && <Button onClick={startAnother}>{t("agents.phase.new")}</Button>}
                </>
              )}
            </div>}

            {ready && (
              <>
                {phaseTask && (
                  <section className="agent-active-task" aria-labelledby="agent-current-task">
                    {phaseTask.status !== "failed" && <p className="agent-brief-quote">{phaseTask.intent}</p>}
                    <div className="agent-phase-card" data-error={phaseTask.status === "failed" || undefined}>
                      <h3 id="agent-current-task">{t(phaseTask.status === "failed"
                        ? phaseTask.error?.startsWith("BUDGET_EXCEEDED") ? "agents.panel.budgetError" : "agents.phase.error"
                        : "agents.phase.running")}</h3>
                      <p role="status">{phaseTask.status === "failed"
                        ? taskFailureText(phaseTask.error ?? "AI_FAILED", t)
                        : phaseTask.progress?.total
                          ? t("agents.progress", { done: phaseTask.progress.done ?? 0, total: phaseTask.progress.total })
                          : t("agents.phase.preparing")}</p>
                      {phaseTask.status === "failed" && canEdit && (
                        <Button variant="secondary" onClick={startAnother}>{t("agents.phase.edit")}</Button>
                      )}
                    </div>
                    {phaseTask.status !== "failed" && canEdit && (
                      <div className="agent-phase-actions">
                        <Button variant="secondary" disabled={busy} onClick={() => void run(() => api.cancelAgentTask(phaseTask.id))}>{t("agents.panel.stop")}</Button>
                      </div>
                    )}
                  </section>
                )}
                {data.agents.length === 0 ? (
                  <p className="muted">
                    {t("agents.noneYet")}{" "}
                    <Button variant="ghost" size="compact" onClick={onOpenOrg}>
                      {t("agents.openOrg")}
                    </Button>
                  </p>
                ) : !phaseTask && (
                  <form
                    className="agent-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      submit();
                    }}
                  >
                    <Textarea ref={intentField}
                      className="agent-intent"
                      label={t("agents.panel.prompt")}
                      value={intent}
                      rows={4}
                      maxLength={2000}
                      placeholder={t("agents.intentPlaceholder")}
                      onChange={(event) => {
                        setSelectionOnly(false);
                        setIntent(event.target.value);
                      }}
                      disabled={!canEdit}
                    />

                    <fieldset className="agent-skill-picker">
                      <legend>{t("agents.panel.result")}</legend>
                      <div>
                        {[{slug: AUTO_SKILL, name: t("agents.skill.auto")}, ...skills].map((skill) => {
                          const nameKey = skillNameKey(skill.slug);
                          return (
                          <Radio key={skill.slug} label={nameKey ? t(nameKey) : skill.name} name="agent-skill" value={skill.slug}
                              checked={skillSlug === skill.slug} disabled={!canEdit}
                              onChange={() => {
                                setSkillSlug(skill.slug);
                                if (skill.slug === "cards" && sourceIds.length > maxActions) {
                                  setMaxActions(Math.min(500, Math.max(20, sourceIds.length)));
                                }
                              }} />
                          );
                        })}
                      </div>
                    </fieldset>
                    <div className="agent-card-options">
                      {isCards && (
                        <>
                          <Select
                            label={t("agents.cardTarget")}
                            options={[
                              { value: "standalone", label: t("agents.standalone") },
                              { value: "kanban", label: t("agents.kanban") },
                            ]}
                            value={targetKind}
                            onChange={(event) => setTargetKind(event.target.value as typeof targetKind)}
                            disabled={!canEdit}
                          />
                          <Select
                            label={t("agents.mode")}
                            options={[
                              { value: "copy", label: t("agents.keep") },
                              { value: "move", label: t("agents.move") },
                            ]}
                            value={mode}
                            onChange={(event) => setMode(event.target.value as typeof mode)}
                            disabled={!canEdit}
                          />
                        </>
                      )}
                    </div>
                    <details className="agent-input-disclosure">
                      <summary>{t("agents.modelInput")}</summary>
                      <section className="agent-payload" aria-label={t("agents.modelInput")}>
                        <p className="muted">{selectedDescriptionKey ? t(selectedDescriptionKey) : selectedSkill?.description ?? t("agents.skill.autoHint")}</p>
                    <AgentSelectionSource
                      preview={context.selection}
                      hasSelection={hasSelection}
                      selectionOnly={selectionOnly}
                      onRemove={() => {
                        setSourceIds([]);
                        setSelectionOnly(false);
                      }}
                      onOnly={() => {
                        setIntent(t("agents.source.onlyIntent"));
                        setFile(null);
                        setFileError(null);
                        setSelectionOnly(true);
                      }}
                    />

                    {isBrief && (
                      <section className="agent-file-section" aria-label={t("agents.file.attach")}>
                        <strong>{t("agents.file.attach")}</strong>
                        <AgentFileField
                          file={file}
                          onFile={setFile}
                          error={fileError}
                          onError={setFileError}
                          disabled={!canEdit || busy}
                        />
                      </section>
                    )}

                      {modelSkill !== "cards" && modelSkill !== "tidy-selection" && (
                        <p className="muted">{t("agents.modelIntent")}: {intent.trim() || "—"}</p>
                      )}
                      {modelSkill !== "cards" && hasSelection && (
                        <details>
                          <summary>{t("agents.modelFragments", { n: modelObjects.length })}</summary>
                          <ul>{modelObjects.map((item) => (
                            <li key={item.id}><span className="muted">{item.type}</span> {item.text}</li>
                          ))}</ul>
                        </details>
                      )}
                      {modelSkill === "cards" ? (
                        <p className="muted">{t("agents.modelCards")}</p>
                      ) : modelSkill === "brief-to-board" ? (
                        <>
                          {file ? (
                            <details>
                              <summary>{t("agents.modelFile", {name: file.name, kind: file.kind, bytes: file.bytes})}</summary>
                              <pre>{file.modelText}</pre>
                            </details>
                          ) : <p className="muted">{t("agents.modelNoFile")}</p>}
                          <details><summary>
                            {snapshotTotal > snapshotSent
                              ? t("agents.modelSnapshotTruncated", { sent: snapshotSent, total: snapshotTotal })
                              : t("agents.modelSnapshot", { n: snapshotSent })}
                          </summary><pre>{JSON.stringify(context.snapshot, null, 2)}</pre></details>
                          <p className="muted">{t("agents.modelFileUntrusted")}</p>
                        </>
                      ) : !hasSelection ? (
                        <p className="muted">{t("agents.modelEmpty")}</p>
                      ) : null}
                    </section>
                    </details>

                    <div className="agent-budget">
                      <Input
                        type="number"
                        label={t("agents.maxActions")}
                        min={1}
                        max={500}
                        value={maxActions}
                        onChange={(event) => setMaxActions(Number(event.target.value) || 1)}
                        disabled={!canEdit}
                      />
                      <Input
                        type="number"
                        label={t("agents.maxCost")}
                        min={0}
                        max={5}
                        step={0.01}
                        value={maxCostUsd}
                        onChange={(event) => setMaxCostUsd(Number(event.target.value) || 0)}
                        disabled={!canEdit}
                      />
                    </div>
                    {cardsBlocked && <p className="muted">{t("agents.selectForCards")}</p>}
                    {!canEdit && <p className="muted">{t("agents.readOnly")}</p>}
                    {!budgetReady && <p className="auth-error">{t("agents.budgetRequired")}</p>}
                    <div className="agent-actions">
                      <Button variant="primary"
                        type="submit"
                        disabled={
                          !canEdit ||
                          busy ||
                          !agentId ||
                          !intent.trim() ||
                          cardsBlocked ||
                          !budgetReady ||
                          Boolean(fileError)
                        }>
                        {repeat !== "once"
                          ? t("agents.schedule")
                          : isCards
                            ? jobPreview
                              ? t("agents.runJob")
                              : t("agents.preview")
                            : modelSkill === "brief-to-board" ? t("agents.panel.create") : t("agents.run")}
                      </Button>
                    </div>
                    <p className="muted agent-task-guidance">{modelSkill === "brief-to-board" ? t("agents.panel.reviewFirst") : t("agents.placeHint")}</p>
                  </form>
                )}

                {notice && <p className="muted agent-notice">{notice}</p>}

                {history}

                {changeSets.length > 0 && (
                  <section className="agent-history">
                    <strong>
                      {t("agents.changeSets")} <HelpLink topicId="agents.task" />
                    </strong>
                    <ul>
                      {changeSets.slice(0, 6).map((set) => (
                        <li key={set.id}>
                          <div>
                            <span className={`agent-status ${set.status}`}>
                              {t(`agents.changeSetStatus.${set.status}` as "agents.changeSetStatus.draft")}
                            </span>
                            <span className="agent-task-intent">
                              {t("agents.changeSetCards", { n: set.estimate?.cards ?? 0 })}
                            </span>
                          </div>
                          <div className="muted">
                            {set.agent_name ? `${set.agent_name} · ` : ""}
                            {formatMoment(set.created_at, lang)}
                            {set.progress?.total
                              ? ` · ${t("agents.progress", {
                                  done: set.progress.done ?? 0,
                                  total: set.progress.total,
                                })}`
                              : ""}
                            {set.error ? ` · ${set.error}` : ""}
                          </div>
                          {(set.status === "queued" || set.status === "running") && (
                            <Button variant="ghost" size="compact"
                              disabled={busy}
                              onClick={() => void run(() => api.cancelChangeSet(set.id))}>
                              {t("agents.stopJob")}
                            </Button>
                          )}
                          {(set.status === "failed" || set.status === "cancelled") && (
                            <Button variant="ghost" size="compact"
                              disabled={busy}
                              onClick={() => void run(() => api.resumeChangeSet(set.id))}>
                              {t("agents.resume")}
                            </Button>
                          )}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {(data.schedules ?? []).length > 0 && (
                  <section className="agent-history">
                    <strong>{t("agents.schedules")}</strong>
                    <ul>
                      {data.schedules.map((schedule) => (
                        <li key={schedule.id}>
                          <div>
                            <span className="agent-status queued">{t("agents.scheduled")}</span>
                            <span className="agent-task-intent">{schedule.intent}</span>
                          </div>
                          <div className="muted">
                            {t("agents.nextRun", {
                              date: formatMoment(schedule.next_run_at, lang),
                              every: t("agents.interval", { n: Math.round(schedule.interval_seconds / 3600) }),
                            })}
                          </div>
                          <Button variant="ghost" size="compact"
                            disabled={busy}
                            onClick={() => void run(() => api.deleteAgentSchedule(schedule.id))}>
                            {t("agents.stopSchedule")}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </>
            )}

            {loading && !data.tasks.length && <p className="muted">{t("agents.loading")}</p>}
          </>
        )}
      </section>
    </Dialog>
  );
}
