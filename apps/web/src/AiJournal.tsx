import { useEffect, useState } from "react";
import { Button, Link } from "@remo/ui";
import { api, type AiChainCheck } from "./api";
import { call } from "./apiCall";
import { useI18n } from "./i18n";

/** Show the current UTC month. The historical journal stays available as a streamed download. */
export function AiJournal({ orgId }: { orgId: string }) {
  return <JournalSummary key={orgId} orgId={orgId} />;
}

function readSummary(orgId: string) {
  return call<{ calls: number; costUsd: string }>(`/orgs/${encodeURIComponent(orgId)}/ai/runs/summary`);
}

function JournalSummary({ orgId }: { orgId: string }) {
  const { lang, t } = useI18n();
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof readSummary>> | null>(null);
  const [check, setCheck] = useState<AiChainCheck | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    readSummary(orgId).then(data => {
      if (active) setSummary(data);
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [orgId]);

  async function verify() {
    setBusy(true);
    setFailed(false);
    try {
      const data = await readSummary(orgId);
      setSummary(data);
      setCheck(await api.verifyAiRuns(orgId));
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  const amount = summary && new Intl.NumberFormat(lang, {
    style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 8,
  }).format(Number(summary.costUsd));
  return (
    <section className="ai-journal" aria-label={t("aiLog.title")}>
      {summary && <p>{t("aiLog.month", { n: summary.calls, amount: amount ?? "" })}</p>}
      {check && <p role="status">{check.ok ? t("aiLog.ok", { n: check.checked })
        : t("aiLog.broken", { seq: check.brokenAt ?? 0, reason: check.reason ?? "" })}</p>}
      {failed && <p role="alert">{t("aiLog.failed")}</p>}
      <div className="action-row">
        <Button variant="ghost" size="compact" loading={busy} onClick={() => void verify()}>{t("aiLog.verify")}</Button>
        <Link href={"/api/orgs/" + encodeURIComponent(orgId) + "/ai/runs/export.csv"} download="remuka-ai-journal.csv">
          {t("aiLog.exportCsv")}
        </Link>
      </div>
    </section>
  );
}
