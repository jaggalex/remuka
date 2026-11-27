import { Button, Input, Switch, Tabs } from "@remo/ui";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { api, type Agent, type AgentSkill, type AgentToken } from "./api";
import { formatMoment } from "./format";
import { useI18n, type TranslationKey } from "./i18n";
import { skillDescriptionKey } from "./skillText";
import { AiCredentials } from "./AiCredentials";
import { AiJournal } from "./AiJournal";
import "./styles/organisation-agents.css";

/**
 * Agents in the organisation panel.
 *
 * An agent is a principal owned by one person: the list shows whose it is, whether it
 * is enabled, and the keys it uses. The organisation switch is the kill switch; a
 * board owner still has to allow agents on the board itself (spec/AI-agents-v1.md §3).
 */
const builtInTitles: Record<string, TranslationKey> = {
  "brief-to-board": "agents.catalogBrief", diagram: "agents.catalogDiagram", cards: "agents.catalogCards",
  "room-draft": "agents.catalogDraft", "tidy-selection": "agents.catalogTidy",
};

interface AgentsPanelProps {
  orgId: string;
  isOrgAdmin: boolean;
  canReadJournal: boolean;
  meId: string | null;
}

export function AgentsPanel({ orgId, isOrgAdmin, canReadJournal, meId, orgName, slug, navigation }:
  AgentsPanelProps & { orgName: string; slug?: string; navigation: ReactNode }) {
  const { t } = useI18n();
  const [tab, setTab] = useState("agents");
  const journal = canReadJournal && <AiJournal orgId={orgId} />;
  return (
    <section className="org-ai-settings" aria-label={t("agents.orgTitle")}>
      <header className="org-ai-heading">
        <details>
          <summary>{orgName} › {t("org.title")}</summary>
          <nav aria-label={t("org.title")}>
            <a href={"/rooms?org=" + encodeURIComponent(slug ?? orgId)}>{t("board.allBoards")}</a>
            {navigation}
          </nav>
        </details>
        <h1>{t("agents.orgTitle")}</h1>
      </header>
      <Tabs label={t("agents.orgTitle")} value={tab} onChange={setTab}
        tabs={[{ id: "agents", label: t("org.agents") }, { id: "keys", label: t("aiKeys.tab") }]} />
      {tab === "agents" ? <AgentList key={orgId} orgId={orgId} isOrgAdmin={isOrgAdmin} meId={meId} />
        : <AiCredentials key={orgId} orgId={orgId} isOrgAdmin={isOrgAdmin} journal={journal} />}
      {tab === "agents" && journal}
    </section>
  );
}

function AgentList({ orgId, isOrgAdmin, meId }: Omit<AgentsPanelProps, "canReadJournal">) {
  const { t, lang } = useI18n();
  const [enabled, setEnabled] = useState(false);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [skills, setSkills] = useState<AgentSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  /** Which agent's keys are open. */
  const [openAgent, setOpenAgent] = useState<string | null>(null);
  const tokenRequest = useRef(0);
  const [tokens, setTokens] = useState<AgentToken[]>([]);
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [policy, list, catalog] = await Promise.all([
        api.agentPolicy(orgId),
        api.agents(orgId),
        api.skills(orgId),
      ]);
      setEnabled(policy.agentsEnabled);
      setAgents(list.agents);
      setSkills(catalog.skills);
      setError(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("agents.failed"));
    } finally {
      setLoading(false);
    }
  }, [orgId, t]);

  useEffect(() => {
    void refresh();
    setOpenAgent(null);
    setSecret(null);
  }, [refresh]);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("agents.failed"));
    } finally {
      setBusy(false);
    }
  };

  const openTokens = async (agentId: string) => {
    const request = ++tokenRequest.current;
    setSecret(null);
    setTokens([]);
    if (openAgent === agentId) {
      setOpenAgent(null);
      return;
    }
    setOpenAgent(agentId);
    try {
      const result = await api.agentTokens(agentId);
      if (request === tokenRequest.current) setTokens(result.tokens);
    } catch (failure) {
      if (request === tokenRequest.current) setError(failure instanceof Error ? failure.message : t("agents.failed"));
    }
  };

  return (
    <div className="org-agents">
      <div className="org-agents-head">
        {isOrgAdmin ? (
          <Switch className="org-agents-switch" aria-label={t("agents.orgSwitch")}
            label={<><strong>{t("agents.orgSwitch")}</strong><span>{t("agents.body")}</span></>}
            checked={enabled} disabled={busy || loading}
            onChange={event => {
              const next = event.target.checked;
              void run(async () => {
                await api.setAgentPolicy(orgId, next);
                setOpenAgent(null);
                setSecret(null);
              });
            }} />
        ) : <div><strong>{t("agents.title")}</strong><p>{t("agents.body")}</p></div>}
      </div>

      {error && <p className="auth-error">{error}</p>}

      {!enabled ? (
        <p className="org-agents-off">
          {isOrgAdmin ? t("agents.disabledAdmin") : t("agents.disabledMember")}
        </p>
      ) : (
        <>
          <div className="org-agents-content">
          <section className="org-agents-roster">
          <h3>{t("org.agents")} · {agents.length}</h3>
          <ul className="org-agent-list">
            {agents.map((agent) => {
              const own = agent.owner_id === meId;
              const canManage = own || isOrgAdmin;
              return (
                <li key={agent.id} className="org-agent" data-state={agent.state}>
                  <div className="org-agent-main">
                    <span className="org-avatar" aria-hidden="true">
                      ✦
                    </span>
                    <div className="org-agent-name">
                      <div>
                        <strong>{agent.name}</strong>
                        <span className={`org-badge ${agent.state === "active" ? "agent" : "suspended"}`}>
                          {agent.state === "active" ? t("agents.active") : t("agents.disabled")}
                        </span>
                      </div>
                      <span className="muted">
                        {agent.owner_name ?? agent.owner_email ?? ""}
                        {" · "}{t("agents.keys", { n: agent.active_tokens ?? 0 })}
                      </span>
                    </div>
                    {canManage && (
                      <div className="org-person-actions">
                        <Button variant="ghost" size="compact"
                          disabled={busy}
                          aria-expanded={openAgent === agent.id}
                          onClick={() => void openTokens(agent.id)}>
                          {t("agents.keysAction")}
                        </Button>
                        <Button variant="ghost" size="compact"
                          disabled={busy}
                          onClick={() =>
                            void run(() =>
                              api.updateAgent(agent.id, {
                                state: agent.state === "active" ? "disabled" : "active",
                              }),
                            )
                          }>
                          {agent.state === "active" ? t("agents.disable") : t("agents.enable")}
                        </Button>
                      </div>
                    )}
                  </div>

                  {openAgent === agent.id && (
                    <div className="org-agent-tokens">
                      <div className="org-agent-tokens-head">
                        <strong>{t("agents.tokens")}</strong>
                        <Button
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              const created = await api.createAgentToken(agent.id, {
                                label: t("agents.tokenLabel"),
                                expiresInDays: 30,
                              });
                              setOpenAgent(null);
                              setSecret(created.secret);
                              setCopied(false);
                            })
                          }>
                          {t("agents.newToken")}
                        </Button>
                      </div>
                      <ul className="org-token-list">
                        {tokens.map((token) => (
                          <li key={token.id}>
                            <span>{token.label} <code>{token.fingerprint}</code></span>
                            <span className="muted">
                              {token.revoked_at
                                ? t("agents.revoked")
                                : t("agents.expires", { date: formatMoment(token.expires_at, lang) })}
                            </span>
                            {!token.revoked_at && (
                              <Button variant="ghost" size="compact"
                                disabled={busy}
                                onClick={() =>
                                  void run(async () => {
                                    await api.revokeAgentToken(agent.id, token.id);
                                    setTokens((await api.agentTokens(agent.id)).tokens);
                                  })
                                }>
                                {t("agents.revoke")}
                              </Button>
                            )}
                          </li>
                        ))}
                        {!tokens.length && <li className="muted">{t("agents.noTokens")}</li>}
                      </ul>
                    </div>
                  )}
                </li>
              );
            })}
            {!agents.length && !loading && <li className="muted">{t("agents.empty")}</li>}
          </ul>

          {secret && (
            <div className="org-agent-secret" role="status">
              <p className="muted">{t("agents.secretOnce")}</p>
              <div className="org-agent-secret-value">
                <Input readOnly aria-label={t("agents.secretOnce")} value={secret} onFocus={(event) => event.target.select()} />
                <Button
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(secret);
                      setCopied(true);
                    } catch {
                      setError(t("agents.copyManually"));
                    }
                  }}>
                  {copied ? t("agents.copied") : t("agents.copy")}
                </Button>
              </div>
            </div>
          )}
          <form
            className="org-agent-create"
            onSubmit={(event) => {
              event.preventDefault();
              if (!name.trim()) return;
              void run(async () => {
                await api.createAgent(orgId, name.trim());
                setName("");
              });
            }}
          >
            <Input
              label={t("agents.newAgent")}
              value={name}
              placeholder={t("agents.namePlaceholder")}
              aria-label={t("agents.namePlaceholder")}
              onChange={(event) => setName(event.target.value)}
            />
            <Button variant="secondary" type="submit" disabled={busy || !name.trim()}>
              {t("agents.create")}
            </Button>
          </form>

          </section>

          <section className="org-skills">
            <h3>{t("agents.skills")}</h3>
            <p className="muted">{t("agents.skillsNote")}</p>
            <ul>
              {skills.map((skill) => {
                const descriptionKey = skill.org_id ? null : skillDescriptionKey(skill.slug);
                const titleKey = skill.org_id ? null : builtInTitles[skill.slug];
                return (
                  <li key={skill.id}>
                    <details>
                      <summary>
                        <span>{titleKey ? t(titleKey) : skill.name}</span>
                        <span className="org-skill-risk" data-risk={skill.risk}>
                          {t(`agents.risk.${skill.risk}` as "agents.risk.read")}
                        </span>
                      </summary>
                      <p>{descriptionKey ? t(descriptionKey) : skill.description} · {skill.slug}@{skill.version}</p>
                    </details>
                  </li>
                );
              })}
            </ul>
          </section>
          </div>
        </>
      )}

    </div>
  );
}
