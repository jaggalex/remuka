import { useCallback, useEffect, useState } from "react";
import { Button, Input, Table, type TableColumn } from "@remo/ui";
import { formatDateTime } from "../format";
import { useI18n } from "../i18n";
import { operatorApi, type JournalEvent } from "./operatorApi";

/**
 * «Журнал»: what operators did, across tenants (`spec/operator.md` §5, stage 2).
 *
 * The audit table is the source; this screen only filters and prints. A row that names no
 * person is the server itself (`operator.granted` from the bootstrap), and the screen says
 * so instead of leaving the cell empty.
 */
export function OperatorJournal() {
  const { t, lang } = useI18n();
  const [action, setAction] = useState("");
  const [actor, setActor] = useState("");
  const [org, setOrg] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [events, setEvents] = useState<JournalEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const read = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const result = await operatorApi.journal({
        action,
        actor,
        org,
        from: from ? new Date(`${from}T00:00:00Z`).toISOString() : "",
        to: to ? new Date(`${to}T00:00:00Z`).toISOString() : "",
        limit: 200,
      });
      setEvents(result.events);
    } catch {
      setError(true);
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [action, actor, org, from, to]);

  useEffect(() => {
    void read();
  }, [read]);

  const columns: TableColumn<JournalEvent>[] = [
    {
      key: "at",
      label: t("operator.journal.time"),
      render: (row) => formatDateTime(row.at, lang),
    },
    {
      key: "actor",
      label: t("operator.journal.who"),
      render: (row) => row.actorEmail ?? t("operator.journal.system"),
    },
    { key: "action", label: t("operator.journal.what") },
    {
      key: "channel",
      label: t("operator.journal.channel"),
      render: (row) =>
        row.channel ? (row.mfa ? `${row.channel} / ${row.mfa}` : row.channel) : "—",
    },
    {
      key: "where",
      label: t("operator.journal.where"),
      render: (row) => row.orgName ?? row.orgId ?? "—",
    },
    {
      // `subject` is what the event was about (an account, a session, an invoice), never a
      // reason: showing it under «Reason» made an id read as the operator's explanation.
      key: "subject",
      label: t("operator.journal.subject"),
      render: (row) => row.subject ?? "—",
    },
    {
      key: "reason",
      label: t("operator.journal.reason"),
      render: (row) => row.reason ?? "—",
    },
  ];

  return (
    <div className="operator-journal">
      <form
        className="operator-filters"
        onSubmit={(event) => {
          event.preventDefault();
          void read();
        }}
      >
        <Input
          label={t("operator.journal.action")}
          value={action}
          onChange={(event) => setAction(event.target.value)}
          placeholder="billing."
        />
        <Input
          label={t("operator.journal.actor")}
          value={actor}
          onChange={(event) => setActor(event.target.value)}
        />
        <Input
          label={t("operator.journal.org")}
          value={org}
          onChange={(event) => setOrg(event.target.value)}
        />
        <Input
          label={t("operator.journal.from")}
          type="date"
          value={from}
          onChange={(event) => setFrom(event.target.value)}
        />
        <Input
          label={t("operator.journal.to")}
          type="date"
          value={to}
          onChange={(event) => setTo(event.target.value)}
        />
        <div className="operator-filter-actions">
          <Button type="submit" variant="primary" loading={loading}>
            {t("operator.journal.apply")}
          </Button>
          <Button
            type="button"
            onClick={() => {
              setAction("");
              setActor("");
              setOrg("");
              setFrom("");
              setTo("");
            }}
          >
            {t("operator.journal.clear")}
          </Button>
        </div>
      </form>

      {error && <p className="operator-note">{t("operator.failed")}</p>}
      {!error && events.length === 0 && !loading && (
        <p className="operator-note">{t("operator.journal.empty")}</p>
      )}
      {events.length > 0 && <Table columns={columns} rows={events} maxHeight={640} />}
    </div>
  );
}
