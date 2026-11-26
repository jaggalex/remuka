import { Button } from "@remo/ui";
import type { AgentTask } from "./api";
import { taskFailureText } from "./agentError";
import { formatMoment } from "./format";
import { useI18n } from "./i18n";

export function AgentTaskHistory({ tasks, busy, onPlan, onCancel }: {
  tasks: AgentTask[];
  busy: boolean;
  onPlan: (id: string) => void;
  onCancel: (id: string) => void;
}) {
  const { t, lang } = useI18n();
  return (
    <section className="agent-history agent-task-history">
      <strong>{t("agents.panel.past")}</strong>
      {!tasks.length && <p className="muted">{t("agents.panel.noHistory")}</p>}
      <ul>
        {tasks.slice(0, 6).map((task) => (
          <li key={task.id}>
            <div>
              <span className="agent-task-intent">{task.intent}</span>
              <span className={`agent-status ${task.status}`}>{t(`agents.status.${task.status}` as "agents.status.queued")}</span>
            </div>
            <div className="muted">
              {task.agent_name} · {formatMoment(task.created_at, lang)}
              {task.error ? ` · ${taskFailureText(task.error, t)}` : ""}
              {task.status === "running" && task.progress?.total
                ? ` · ${t("agents.progress", {
                    done: task.progress.done ?? 0,
                    total: task.progress.total,
                  })}`
                : ""}
              {task.status === "applied" && task.usage?.actions
                ? ` · ${t("agents.changes", { n: task.usage.actions })}`
                : ""}
            </div>
            {(task.skill_slug === "brief-to-board" ||
              task.skill_slug === "tidy-selection") &&
              (task.status === "awaiting_approval" || task.status === "applied") && (
                <Button variant="ghost" size="compact"
                  onClick={() => onPlan(task.id)}>
                  {t("agents.plan.open")}
                </Button>
              )}
            {(task.status === "queued" || task.status === "running") && (
              <Button variant="ghost" size="compact"
                disabled={busy}
                onClick={() => onCancel(task.id)}>
                {t("agents.cancel")}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
