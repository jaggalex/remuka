import { useEffect, useState } from "react";
import { Button, Dialog, Input } from "@remo/ui";
import { formatDateTime } from "../format";
import { useI18n } from "../i18n";
import {
  operatorApi,
  type CustomerMatch,
  type CustomerOrg,
  type OperatorMeasure,
} from "./operatorApi";
import { MeasureDialog, RevertDialog, measureKindKey, roomIdFrom, type NeedCode } from "./OperatorActionDialog";

/**
 * «Жалобы» (`spec/operator-actions.md` §4.3): open measures, a new measure by room link or
 * by organisation, and lifting one. The measure itself is the CLI's row; this screen only
 * chooses the target and the reason the administrators will read.
 */
type Target = { org: CustomerOrg } | { room: string } | null;

export function OperatorMeasures({ onNeedCode }: { onNeedCode: NeedCode }) {
  const { t, lang } = useI18n();
  const [actions, setActions] = useState<OperatorMeasure[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [picking, setPicking] = useState(false);
  const [target, setTarget] = useState<Target>(null);
  const [reverting, setReverting] = useState<OperatorMeasure | null>(null);

  const load = () => {
    setFailed(false);
    operatorApi
      .measures()
      .then((result) => setActions(result.actions))
      .catch(() => setFailed(true));
  };

  useEffect(() => {
    load();
  }, []);

  const pick = (match: CustomerMatch) => {
    setPicking(false);
    operatorApi
      .customer("org", match.id)
      .then((card) => {
        const org = card.orgs[0];
        if (org) setTarget({ org });
      })
      .catch(() => setFailed(true));
  };

  return (
    <div className="operator-section">
      <div className="operator-actions">
        <h2>{t("operator.measures.title")}</h2>
        <Button variant="secondary" size="compact" onClick={() => setPicking(true)}>
          {t("operator.measures.new")}
        </Button>
      </div>
      {failed && <p className="operator-note">{t("operator.failed")}</p>}
      {!actions && !failed && <p className="operator-note">{t("operator.loading")}</p>}
      {actions && actions.length === 0 && (
        <p className="operator-note">{t("operator.measures.empty")}</p>
      )}
      {actions && actions.length > 0 && (
        <table className="operator-table">
          <thead>
            <tr>
              <th>{t("operator.measures.kind")}</th>
              <th>{t("operator.measures.target")}</th>
              <th>{t("operator.measures.author")}</th>
              <th>{t("operator.measures.reason")}</th>
              <th>{t("operator.measures.date")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {actions.map((action) => (
              <tr key={action.id}>
                <td>{t(measureKindKey(action.kind))}</td>
                <td>{action.boardTitle || action.orgName || action.subjectId}</td>
                <td>{action.createdByEmail || "—"}</td>
                <td>
                  {action.reasonInternal}
                  {action.reasonPublic !== action.reasonInternal && (
                    <small className="operator-note">{action.reasonPublic}</small>
                  )}
                </td>
                <td>{formatDateTime(action.createdAt, lang)}</td>
                <td>
                  <Button size="compact" variant="ghost-danger" onClick={() => setReverting(action)}>
                    {t("operator.measures.revert")}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {picking && (
        <TargetPicker
          onPick={pick}
          onRoom={(room) => {
            setPicking(false);
            setTarget({ room: roomIdFrom(room) });
          }}
          onClose={() => setPicking(false)}
        />
      )}
      {target && "org" in target && (
        <MeasureDialog
          org={target.org}
          onNeedCode={onNeedCode}
          onDone={() => {
            setTarget(null);
            load();
          }}
          onClose={() => setTarget(null)}
        />
      )}
      {target && "room" in target && (
        <MeasureDialog
          initialRoom={target.room}
          onNeedCode={onNeedCode}
          onDone={() => {
            setTarget(null);
            load();
          }}
          onClose={() => setTarget(null)}
        />
      )}
      {reverting && (
        <RevertDialog
          action={reverting}
          onNeedCode={onNeedCode}
          onDone={() => {
            setReverting(null);
            load();
          }}
          onClose={() => setReverting(null)}
        />
      )}
    </div>
  );
}

/** Room link or a search over organisations; the choice fixes the measure's subject type. */
function TargetPicker({
  onPick,
  onRoom,
  onClose,
}: {
  onPick: (match: CustomerMatch) => void;
  onRoom: (room: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [room, setRoom] = useState("");
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<CustomerMatch[]>([]);

  useEffect(() => {
    const text = query.trim();
    if (text.length < 2) {
      setMatches([]);
      return;
    }
    let alive = true;
    const timer = window.setTimeout(() => {
      operatorApi
        .customers(text)
        .then((result) => {
          if (alive) setMatches(result.matches.filter((match) => match.kind === "org"));
        })
        .catch(() => {
          if (alive) setMatches([]);
        });
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [query]);

  return (
    <Dialog
      title={t("operator.measures.chooseTarget")}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("operator.action.cancel")}
          </Button>
          <Button variant="primary" disabled={!roomIdFrom(room)} onClick={() => onRoom(room)}>
            {t("operator.measures.next")}
          </Button>
        </>
      }
    >
      <Input
        label={t("operator.measures.targetRoom")}
        hint={t("operator.measures.targetRoomHint")}
        value={room}
        onChange={(event) => setRoom(event.target.value)}
      />
      <Input
        type="search"
        label={t("operator.measures.orgSearch")}
        hint={t("operator.measures.findOrg")}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <ul className="operator-matches">
        {matches.map((match) => (
          <li key={match.id}>
            <Button variant="ghost" className="operator-match" onClick={() => onPick(match)}>
              <strong>{match.label}</strong>
              {match.slug && <small>{match.slug}</small>}
            </Button>
          </li>
        ))}
      </ul>
      {query.trim().length >= 2 && matches.length === 0 && (
        <p className="operator-note">{t("operator.customers.empty")}</p>
      )}
    </Dialog>
  );
}
