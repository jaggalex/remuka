import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Segmented, Select, Table } from "@remo/ui";
import { formatMoney } from "../apiBilling";
import { formatDate } from "../format";
import { useI18n, type TranslationKey } from "../i18n";
import { operatorApi, type Pulse } from "./operatorApi";
import { Sparkline } from "./Sparkline";

/**
 * «Пульс» of one installation (`spec/pulse.md` §6, stage 2 of `spec/operator.md` §8).
 *
 * Six tiles, then the sections that fit the data this installation actually has. A value
 * that cannot be counted is `—` with its reason beside it, never `0`: the specification
 * asks for an honest blank, and a zero would be a claim about the world.
 */
const TILE_LABEL: Record<string, TranslationKey> = {
  wact: "operator.pulse.tile.wact",
  mrr: "operator.pulse.tile.mrr",
  paying: "operator.pulse.tile.paying",
  activation7d: "operator.pulse.tile.activation7d",
  retentionW4: "operator.pulse.tile.retentionW4",
  newOrgs: "operator.pulse.tile.newOrgs",
};

const TILE_HINT: Record<string, TranslationKey> = {
  wact: "operator.pulse.tile.wact.hint",
  mrr: "operator.pulse.tile.mrr.hint",
  paying: "operator.pulse.tile.paying.hint",
  activation7d: "operator.pulse.tile.activation7d.hint",
  retentionW4: "operator.pulse.tile.retentionW4.hint",
  newOrgs: "operator.pulse.tile.newOrgs.hint",
};

const PERCENT_TILES = new Set(["activation7d", "retentionW4"]);

export function OperatorPulse() {
  const { t, lang } = useI18n();
  const [weeks, setWeeks] = useState(12);
  const [currency, setCurrency] = useState("");
  const [zone, setZone] = useState("all");
  const [data, setData] = useState<Pulse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const read = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const next = await operatorApi.pulse({ weeks, currency: currency || null, zone });
      setData(next);
      // The server names the currency it actually used; a stale choice must not stick.
      if (next.currency && next.currency !== currency) setCurrency(next.currency);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [weeks, currency, zone]);

  useEffect(() => {
    void read();
  }, [read]);

  if (loading && !data) return <p className="operator-note">{t("operator.loading")}</p>;
  if (error || !data) {
    return (
      <div className="operator-note">
        <p>{t("operator.failed")}</p>
        <Button variant="ghost" size="compact" onClick={() => void read()}>
          {t("operator.retry")}
        </Button>
      </div>
    );
  }

  const money = (value: number | null) =>
    value === null || !data.currency ? t("operator.na") : formatMoney(value, data.currency, lang);

  return (
    <div className="operator-pulse">
      <div className="operator-controls">
        <Segmented
          label={t("operator.pulse.weeks")}
          value={String(weeks)}
          onChange={(next) => setWeeks(Number(next))}
          options={[
            { value: "4", label: t("operator.pulse.weeks.4") },
            { value: "12", label: t("operator.pulse.weeks.12") },
            { value: "26", label: t("operator.pulse.weeks.26") },
          ]}
        />
        {data.zones.filter((entry) => entry.id !== "none").length > 1 && (
          <Segmented
            label={t("operator.pulse.zone")}
            value={zone}
            onChange={setZone}
            options={[
              { value: "all", label: t("operator.pulse.zoneAll") },
              ...data.zones
                .filter((entry) => entry.id !== "none")
                .map((entry) => ({ value: entry.id, label: entry.id.toUpperCase() })),
            ]}
          />
        )}
        {data.currencies.length > 1 && (
          <Select
            label={t("operator.pulse.currency")}
            value={currency}
            onChange={(event) => setCurrency(event.target.value)}
            options={data.currencies}
            size="compact"
          />
        )}
        <span className="operator-zone">{t("operator.zone", { zone: data.zone })}</span>
      </div>
      {data.zoneReason && <p className="operator-note">{data.zoneReason}</p>}
      <p className="operator-note">{t("operator.pulse.currentWeek")}</p>

      <div className="operator-tiles">
        {data.tiles.map((tile, index) => {
          const label = t(TILE_LABEL[tile.id] ?? "operator.na");
          const text =
            tile.value === null
              ? t("operator.pulse.noData")
              : PERCENT_TILES.has(tile.id)
                ? `${tile.value}%`
                : tile.id === "mrr"
                  ? money(tile.value)
                  : new Intl.NumberFormat(lang === "ru" ? "ru-RU" : "en-GB").format(tile.value);
          const delta =
            tile.value !== null && tile.previous !== null ? tile.value - tile.previous : null;
          return (
            <article
              key={tile.id}
              className={index === 0 ? "operator-tile operator-tile-wide" : "operator-tile"}
              title={t(TILE_HINT[tile.id] ?? "operator.na")}
            >
              <h3>{label}</h3>
              <p className="operator-value">{text}</p>
              {delta !== null && (
                <Badge tone={delta >= 0 ? "success" : "warning"}>
                  {delta >= 0 ? "+" : ""}
                  {delta} {t("operator.pulse.previous")}
                </Badge>
              )}
              {tile.basis === "rebuilt" && (
                <Badge tone="info">{t("operator.pulse.rebuilt")}</Badge>
              )}
              {tile.id === "paying" && tile.value !== null && (
                <p className="operator-note">
                  {t("operator.pulse.breakeven", {
                    paying: String(tile.value),
                    target: String(data.breakeven),
                  })}
                </p>
              )}
              {tile.series && (
                <Sparkline
                  values={tile.series}
                  label={`${label}: ${tile.series.join(", ")}`}
                />
              )}
              {tile.value === null && tile.reason && (
                <p className="operator-note">{tile.reason}</p>
              )}
            </article>
          );
        })}
      </div>

      <section className="operator-section">
        <h2>{t("operator.growth.title")}</h2>
        <div className="operator-facts">
          <Fact label={t("operator.growth.registrations")} value={data.growth.registrations} />
          <Fact label={t("operator.growth.activations")} value={data.growth.activations} />
          <Fact label={t("operator.growth.invitations")} value={data.growth.invitations} />
          <Fact label={t("operator.growth.collaborating")} value={data.growth.collaborating} />
          <Fact label={t("operator.growth.paying")} value={data.growth.paying} />
        </div>
        {data.growth.sources.length > 0 ? (
          <Table
            columns={[
              { key: "source", label: t("operator.growth.source") },
              { key: "value", label: "", numeric: true },
            ]}
            rows={data.growth.sources.map((row) => ({ ...row, id: row.source }))}
          />
        ) : (
          <Fact label={t("operator.growth.source")} value={null} reason={data.growth.sourceReason} />
        )}
      </section>

      <section className="operator-section">
        <h2>{t("operator.engagement.title")}</h2>
        <div className="operator-facts">
          <Fact label={t("operator.engagement.dau")} value={data.engagement.dau} />
          <Fact label={t("operator.engagement.wau")} value={data.engagement.wau} />
          <Fact label={t("operator.engagement.mau")} value={data.engagement.mau} />
          <Fact
            label={t("operator.engagement.stickiness")}
            value={data.engagement.stickiness}
            suffix="%"
          />
          <Fact
            label={t("operator.engagement.collaboration")}
            value={data.engagement.collaboration}
            reason={data.engagement.reason}
          />
        </div>
      </section>

      <section className="operator-section">
        <h2>{t("operator.money.title")}</h2>
        <div className="operator-columns">
          <Table
            columns={[
              { key: "currency", label: t("operator.money.mrrByCurrency") },
              {
                key: "amount",
                label: "",
                numeric: true,
                render: (row) => formatMoney(row.amount, row.currency, lang),
              },
            ]}
            rows={data.money.mrrByCurrency.map((row) => ({ ...row, id: row.currency }))}
          />
          <Table
            columns={[
              { key: "plan", label: t("operator.money.byPlan") },
              { key: "amount", label: "", numeric: true, render: (row) => money(row.amount) },
            ]}
            rows={data.money.byPlan.map((row) => ({ ...row, id: row.plan }))}
          />
        </div>
        {data.money.reason && <p className="operator-note">{data.money.reason}</p>}
      </section>

      <section className="operator-section">
        <h2>{t("operator.health.title")}</h2>
        <div className="operator-facts">
          <Fact label={t("operator.health.mailDead")} value={data.health.mailDead} />
          <Fact label={t("operator.health.saveErrors")} value={data.health.storeWriteErrors} />
          <Fact label={t("operator.health.aiUnavailable")} value={data.health.aiUnavailable} />
          <Fact label={t("operator.health.wsRejected")} value={data.health.wsRejected} />
        </div>
        {data.health.reason && <p className="operator-note">{data.health.reason}</p>}
      </section>

      <p className="operator-note">
        {data.lastCompleteDay
          ? t("operator.pulse.lastCompleteDay", { day: data.lastCompleteDay })
          : t("operator.pulse.currentWeek")}{" "}
        · {formatDate(data.generatedAt, lang)}
      </p>
    </div>
  );
}

function Fact({
  label,
  value,
  reason,
  suffix = "",
}: {
  label: string;
  value: number | null;
  reason?: string | null;
  suffix?: string;
}) {
  const { t, lang } = useI18n();
  const text =
    value === null ? t("operator.na") : `${new Intl.NumberFormat(lang === "ru" ? "ru-RU" : "en-GB").format(value)}${suffix}`;
  return (
    <div className="operator-fact">
      <span>{label}</span>
      <strong>{text}</strong>
      {value === null && reason && <small>{reason}</small>}
    </div>
  );
}
