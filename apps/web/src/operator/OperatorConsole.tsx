import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Tabs } from "@remo/ui";
import { ApiError } from "../apiCall";
import { formatDateTime } from "../format";
import { useI18n } from "../i18n";
import { MfaEnrollment } from "../mfa/MfaEnrollment";
import { MfaStepUp } from "../mfa/MfaStepUp";
import { SecurityDialog } from "../mfa/SecurityDialog";
import { operatorApi, type OperatorSession } from "./operatorApi";
import { OperatorWords } from "./OperatorWords";
import { OperatorPulse } from "./OperatorPulse";
import { OperatorCustomers } from "./OperatorCustomers";
import { OperatorJournal } from "./OperatorJournal";
import { OperatorMoney } from "./OperatorMoney";
import { OperatorMeasures } from "./OperatorMeasures";

/**
 * The installation operator's console (`spec/operator.md` §5, ADR-260 §6).
 *
 * It stands before the product shell: only a holder of `instance_operators` sees it, and
 * everyone else gets the service's own `404`, rendered as a plain not-found page. Opening
 * it needs a code no older than twelve hours; the server answers `403 MFA_REQUIRED` with a
 * challenge, and this screen either asks for the code or, for an operator who has not
 * enrolled yet, sends them through enrolment in place.
 */
type Tab = "pulse" | "customers" | "money" | "measures" | "journal" | "words";

interface Gate {
  challenge?: string;
  enrollmentRequired?: boolean;
}

export function OperatorConsole() {
  const { t, lang } = useI18n();
  const [session, setSession] = useState<OperatorSession | null>(null);
  const [gate, setGate] = useState<Gate | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [securityOpen, setSecurityOpen] = useState(false);
  const [stepUp, setStepUp] = useState<{ challenge: string; retry: () => void } | null>(null);
  // The step-up window is measured, not assumed: after `stepUpMs` the console must say so,
  // otherwise "confirmed at 13:18" reads as if the action would go through without a code.
  const [clock, setClock] = useState(() => Date.now());
  const [tab, setTab] = useState<Tab>(() => {
    const value = new URLSearchParams(window.location.search).get("tab");
    return value === "customers" || value === "money" || value === "measures" || value === "journal" || value === "words"
      ? value
      : "pulse";
  });

  useEffect(() => {
    if (!session?.mfaAt) return;
    const until = new Date(session.mfaAt).getTime() + session.stepUpMs;
    const delay = until - Date.now();
    // Already closed: no timer; the first render says so. Otherwise re-render at the edge
    // (plus a second, so the clock has crossed it) without polling.
    if (delay <= 0) return;
    const timer = window.setTimeout(() => setClock(Date.now()), delay + 1_000);
    return () => window.clearTimeout(timer);
  }, [session?.mfaAt, session?.stepUpMs]);

  const load = useCallback(() => {
    operatorApi
      .session()
      .then((data) => {
        setSession(data);
        setGate(null);
      })
      .catch((error) => {
        if (error instanceof ApiError && error.status === 403 && error.code === "MFA_REQUIRED") {
          // The refusal names the operator and, when a factor exists, the challenge the
          // step-up answer will spend. Nothing is rendered until this promise settles.
          setGate({
            challenge:
              typeof error.details.challenge === "string" ? error.details.challenge : undefined,
            enrollmentRequired: error.details.enrollmentRequired === true,
          });
          return;
        }
        setNotFound(true);
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /** The action's 403 MFA_REQUIRED: show the code window and repeat the same form. */
  const requireCode = useCallback(
    (challenge: string, retry: () => void) => {
      if (challenge) setStepUp({ challenge, retry });
      else load();
    },
    [load],
  );

  const stepUpUntil = session?.mfaAt
    ? new Date(session.mfaAt).getTime() + session.stepUpMs
    : null;
  const stepUpOpen = stepUpUntil !== null && clock < stepUpUntil;

  if (notFound) {
    return (
      <main className="operator-page operator-not-found">
        <h1>{t("operator.notFound.title")}</h1>
        <p>{t("operator.notFound.text")}</p>
      </main>
    );
  }

  if (gate?.enrollmentRequired) {
    return (
      <main className="operator-page">
        <header className="operator-header">
          <div>
            <h1>{t("mfa.enrollTitle")}</h1>
            <p className="operator-note">{t("mfa.enrollBody")}</p>
          </div>
          <a className="operator-link" href="/">
            {t("operator.backHome")}
          </a>
        </header>
        <section className="operator-section">
          <MfaEnrollment onDone={load} />
        </section>
      </main>
    );
  }

  if (gate?.challenge) {
    return (
      <main className="operator-page">
        <p className="operator-note">{t("operator.loading")}</p>
        <MfaStepUp
          key={gate.challenge}
          challenge={gate.challenge}
          onDone={() => load()}
          onRetry={() => load()}
          onClose={() => window.location.assign("/")}
        />
      </main>
    );
  }

  if (!session) {
    return (
      <main className="operator-page">
        <p className="operator-note">{t("operator.loading")}</p>
      </main>
    );
  }

  return (
    <main className="operator-page">
      <header className="operator-header">
        <div>
          <h1>{t("operator.title")}</h1>
          <p className="operator-note">{t("operator.subtitle")}</p>
        </div>
        <div className="operator-header-side">
          <Badge tone="info">{session.operator.email}</Badge>
          <Button size="compact" variant="ghost" onClick={() => setSecurityOpen(true)}>
            {t("mfa.menu")}
          </Button>
          <a className="operator-link" href="/">
            {t("operator.backHome")}
          </a>
        </div>
      </header>

      <section className="operator-step-up">
        <Badge tone="success">{t("operator.session.title")}</Badge>
        <p className="operator-note">
          {!session.mfaAt
            ? t("operator.session.notConfirmed")
            : stepUpOpen
              ? t("operator.session.confirmed.open", {
                  at: formatDateTime(session.mfaAt, lang),
                  until: formatDateTime(
                    new Date(new Date(session.mfaAt).getTime() + session.stepUpMs).toISOString(),
                    lang,
                  ),
                })
              : t("operator.session.confirmed.closed", {
                  at: formatDateTime(session.mfaAt, lang),
                })}
        </p>
        {session.enrolled && session.recoveryLeft < 3 && (
          <p className="auth-error">{t("mfa.recoveryLow")}</p>
        )}
      </section>

      <Tabs
        label={t("operator.title")}
        value={tab}
        onChange={(next) => {
          setTab(next as Tab);
          const url = new URL(window.location.href);
          url.searchParams.set("tab", next);
          window.history.replaceState(null, "", url);
        }}
        tabs={[
          { id: "pulse", label: t("operator.tabs.pulse") },
          { id: "customers", label: t("operator.tabs.customers") },
          { id: "money", label: t("operator.tabs.money") },
          { id: "measures", label: t("operator.tabs.measures") },
          { id: "journal", label: t("operator.tabs.journal") },
          { id: "words", label: t("words.title") },
        ]}
      />

      {tab === "pulse" && (
        <>
          <p className="operator-note">{t("operator.zoneNote")}</p>
          <OperatorPulse />
        </>
      )}
      {tab === "customers" && <OperatorCustomers onNeedCode={requireCode} />}
      {tab === "money" && <OperatorMoney />}
      {tab === "measures" && <OperatorMeasures onNeedCode={requireCode} />}
      {tab === "journal" && <OperatorJournal />}
      {tab === "words" && <OperatorWords onNeedCode={requireCode} />}

      <footer className="operator-footer operator-note">{t("operator.session.actions")}</footer>

      {stepUp && (
        <MfaStepUp
          key={stepUp.challenge}
          challenge={stepUp.challenge}
          onDone={() => {
            const retry = stepUp.retry;
            setStepUp(null);
            load();
            retry();
          }}
          onRetry={() => {
            setStepUp(null);
            load();
          }}
          onClose={() => setStepUp(null)}
        />
      )}

      <SecurityDialog
        open={securityOpen}
        onClose={() => {
          setSecurityOpen(false);
          // Enrolling here changes what the console may answer; read the session again.
          load();
        }}
      />
    </main>
  );
}
