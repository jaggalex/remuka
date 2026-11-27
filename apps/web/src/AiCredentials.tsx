import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Input, Segmented, Select } from "@remo/ui";
import { api, type AiCredential, type AiPolicy } from "./api";
import { useI18n } from "./i18n";

/**
 * Provider keys: one set for the person, one for the organisation.
 *
 * A secret is write-only: it goes up once and comes back as a fingerprint. Neither an
 * organisation admin nor support can read it; the service decrypts it only while a task
 * runs (spec/AI-agents-architecture.md).
 */
export function AiCredentials({
  orgId,
  isOrgAdmin,
  journal,
}: {
  orgId: string;
  isOrgAdmin: boolean;
  journal: ReactNode;
}) {
  const { t } = useI18n();
  const [policy, setPolicy] = useState<AiPolicy>({
    keyMode: "either",
    providers: [],
    models: [],
  });
  const [personal, setPersonal] = useState<AiCredential[]>([]);
  const [orgKeys, setOrgKeys] = useState<AiCredential[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [scope, setScope] = useState<"personal" | "org">(isOrgAdmin ? "org" : "personal");
  const keyFormRef = useRef<HTMLFormElement>(null);
  const [provider, setProvider] = useState("openrouter");
  const [model, setModel] = useState("");
  const [label, setLabel] = useState("");
  const [secret, setSecret] = useState("");
  const [baseUrl, setBaseUrl] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [nextPolicy, mine, org] = await Promise.all([
        api.aiPolicy(orgId),
        api.userCredentials(),
        isOrgAdmin ? api.orgCredentials(orgId) : Promise.resolve({ credentials: [] }),
      ]);
      setPolicy(nextPolicy.policy);
      setPersonal(mine.credentials);
      setOrgKeys(org.credentials);
      setError(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("aiKeys.failed"));
    }
  }, [orgId, isOrgAdmin, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      await refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("aiKeys.failed"));
    } finally {
      setBusy(false);
    }
  };

  function changePolicy(keyMode: string) {
    const previous = policy;
    const next = { ...policy, keyMode: keyMode as AiPolicy["keyMode"] };
    setPolicy(next);
    void run(async () => {
      try {
        await api.setAiPolicy(orgId, next);
      } catch (failure) {
        setPolicy(previous);
        throw failure;
      }
    });
  }

  const submit = (scope: "personal" | "org") => {
    if (!secret.trim()) return;
    void run(async () => {
      const body = {
        provider,
        secret: secret.trim(),
        label: label.trim() || undefined,
        model: model.trim() || undefined,
        baseUrl: provider === "custom" ? baseUrl.trim() : undefined,
      };
      if (scope === "personal") await api.createUserCredential(body);
      else await api.createOrgCredential(orgId, body);
      setSecret("");
      setLabel("");
      setModel("");
      setBaseUrl("");

      setNotice(t("aiKeys.saved"));
    });
  };

  const rows = (list: AiCredential[], scope: "personal" | "org") =>
    list.map((key) => (
      <li key={key.id} className="ai-key">
        <div className="ai-key-main">
          <strong>{[key.label, key.provider, key.model].filter(Boolean).join(" · ")}</strong>
          <span className="muted">
            <code>{key.fingerprint}</code>
            {key.isDefault && <span className="ai-key-default">{t("aiKeys.default")}</span>}
          </span>
        </div>
        <div className="ai-key-actions">
          <Button variant="ghost" size="compact"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                if (scope === "personal") await api.testUserCredential(key.id);
                else await api.testOrgCredential(orgId, key.id);
                setNotice(t("aiKeys.tested"));
              })
            }>
            {t("aiKeys.test")}
          </Button>
          {!key.isDefault && (
            <Button variant="ghost" size="compact"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  if (scope === "personal") await api.defaultUserCredential(key.id);
                  else await api.orgCredentialDefault(orgId, key.id);
                })
              }>
              {t("aiKeys.default")}
            </Button>
          )}
          <Button variant="ghost" size="compact"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                if (scope === "personal") await api.deleteUserCredential(key.id);
                else await api.deleteOrgCredential(orgId, key.id);
              })
            }>
            {t("aiKeys.revoke")}
          </Button>
        </div>
      </li>
    ));

  function chooseScope(next: "personal" | "org") {
    if (scope !== next) {
      setSecret("");
      setScope(next);
    }
    keyFormRef.current?.querySelector("select")?.focus();
  }

  return (
    <div className="ai-keys">
      {journal}
      {error && <p role="alert" className="auth-error">{error}</p>}
      {notice && !error && <p role="status" className="ai-key-feedback">{notice}</p>}
      <div className="ai-key-controls">
        <div className="ai-key-brief">
          <strong>{t("aiKeys.safetyTitle")}</strong>
          <p>{t("aiKeys.safetyBody")}</p>
        </div>
        {isOrgAdmin && <div className="ai-key-policy">
          <strong>{t("aiKeys.paymentSource")}</strong>
          <Segmented label={t("aiKeys.mode")} value={policy.keyMode}
            options={[
              { value: "either", label: t("aiKeys.modeEither"), disabled: busy },
              { value: "org", label: t("aiKeys.modeOrg"), disabled: busy },
              { value: "personal", label: t("aiKeys.modePersonal"), disabled: busy },
            ]}
            onChange={changePolicy} />
        </div>}
        {isOrgAdmin && <section className="ai-key-section">
          <div className="ai-key-head">
            <strong>{t("aiKeys.orgTitle")}</strong>
            <Button size="compact" onClick={() => chooseScope("org")}>{t("aiKeys.add")}</Button>
          </div>
          <ul>{rows(orgKeys, "org")}</ul>
          {!orgKeys.length && <p>{t("aiKeys.emptyOrg")}</p>}
        </section>}
        <section className="ai-key-section is-personal">
          <div className="ai-key-head">
            <strong>{t("aiKeys.personalTitle")}</strong>
            <Button size="compact" onClick={() => chooseScope("personal")}>{t("aiKeys.add")}</Button>
          </div>
          <ul>{rows(personal, "personal")}</ul>
          <p>{!personal.length && t("aiKeys.emptyPersonal") + " "}{t("aiKeys.note")}</p>
        </section>
      </div>
      {keyForm(isOrgAdmin ? scope : "personal")}
    </div>
  );

  function keyForm(scope: "personal" | "org") {
    return (
      <form
        className="ai-key-form" ref={keyFormRef} aria-labelledby="provider-key-heading"
        autoComplete="off"
        onSubmit={(event) => {
          event.preventDefault();
          submit(scope);
        }}
      >
        <h3 id="provider-key-heading">{t("aiKeys.add")}</h3>
        <p className="ai-key-scope">{t(scope === "org" ? "aiKeys.orgTitle" : "aiKeys.personalTitle")}</p>
        <Select
          label={t("aiKeys.provider")}
          value={provider}
          options={[
            { value: "openrouter", label: "OpenRouter" },
            { value: "cerebras", label: "Cerebras" },
            { value: "openai", label: "OpenAI" },
            { value: "custom", label: t("aiKeys.custom") },
          ]}
          onChange={(event) => setProvider(event.target.value)}
        />
        {provider === "custom" && (
          <Input
            label={t("aiKeys.baseUrl")}
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder="https://gateway.example.com/v1"
          />
        )}
        <Input label={t("aiKeys.model")} value={model}
          onChange={event => setModel(event.target.value)} />
        <Input label={t("aiKeys.label")} value={label} onChange={(event) => setLabel(event.target.value)} />
        <Input
          label={t("aiKeys.secret")}
          type="password"
          name="providerSecret"
          autoComplete="new-password"
          spellCheck={false}
          data-lpignore="true"
          data-1p-ignore="true"
          value={secret}
          onChange={(event) => setSecret(event.target.value)}
          placeholder="sk-…"
        />
        <div className="agent-actions">
          <span className="muted">{t("aiKeys.secretNote")}</span>
          <Button variant="primary" type="submit"
            disabled={busy || !secret.trim() || (provider === "custom" && !baseUrl.trim())}>
            {t("aiKeys.save")}
          </Button>
        </div>
      </form>
    );
  }
}
