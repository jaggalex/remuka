/**
 * The cookie layer: one place that reads the zone, asks `GET /consent`, renders the §6
 * surface and opens the settings screen (§6.3).
 *
 * The provider sits under the i18n provider and above every route: the home, a room, help
 * and the policy page all reach the same choice. Nothing is stored in `sessionStorage` or
 * `localStorage` — the server's `remo_consent` cookie is the only state (§4), so closing
 * the tab or opening the guide does not ask again.
 *
 * A room holds the plate while a presentation or a followed view is open (§6.5): the
 * screen then belongs to the presenter. The hold is a context call, not a DOM check, so a
 * test can prove the rule where the state lives.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Button } from "@remo/ui";
import type { ConsentCategory } from "@remo/consent";
import { ConsentBanner, ConsentNotice } from "./ConsentNotice";
import { ConsentSettingsDialog } from "./ConsentSettingsDialog";
import { configureConsentGate } from "./consentGate";
import {
  ConsentOutdatedError,
  bulkChoices,
  consentSurface,
  globalPrivacyControl,
  loadConsent,
  saveConsent,
  unansweredChoices,
  type ConsentAnswer,
  type ConsentSurface,
  type ConsentView,
} from "./consentClient";
import { useCompliance, useI18n } from "./i18n";

interface ConsentContextValue {
  readonly view: ConsentView;
  readonly surface: ConsentSurface;
  /** The choice is confirmed by the server. */
  readonly ready: boolean;
  readonly busy: boolean;
  readonly error: string | null;
  openSettings: () => void;
  closeSettings: () => void;
  /** §6.5: hide the plate while a presentation or a followed camera is open. */
  hold: (value: boolean) => void;
  /** Save a choice; `true` means the server confirmed it. */
  save: (choices: Partial<Record<ConsentCategory, boolean>>) => Promise<boolean>;
  /** The policy page, or the operator's own address when configured (§3). */
  readonly policyHref: string;
  /** The separate personal-data consent document of the `ru` zone, when the operator set one. */
  readonly personalDataHref: string | null;
}

const ConsentContext = createContext<ConsentContextValue | null>(null);

export function ConsentProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const compliance = useCompliance();
  const zone = compliance.zone;
  const [answer, setAnswer] = useState<ConsentAnswer | null>(null);
  const [ready, setReady] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [held, setHeld] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The browser's signal is read once: it is a browser setting, not a page state.
  const [gpc] = useState(() =>
    globalPrivacyControl(typeof navigator === "undefined" ? null : navigator),
  );

  const view = useMemo<ConsentView>(
    () => ({
      zone,
      answered: answer !== null,
      choices: answer?.choices ?? unansweredChoices(zone),
      gpc,
    }),
    [answer, gpc, zone],
  );

  // One read per zone. A failed read leaves the notice in place: the choice is then
  // simply not saved, which is the safe state for every category.
  useEffect(() => {
    if (zone === "none") {
      setAnswer(null);
      setReady(true);
      return;
    }
    let alive = true;
    setReady(false);
    loadConsent(zone)
      .then((next) => {
        if (alive) setAnswer(next);
      })
      .catch(() => {
        // An older service without `/consent` is treated like a browser with no choice.
      })
      .finally(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
  }, [zone]);

  // The gate learns the choice after every change, including a withdrawal (§5).
  useEffect(() => {
    configureConsentGate({ zone: view.zone, choices: view.choices, gpc: view.gpc });
  }, [view]);

  const save = useCallback(
    async (choices: Partial<Record<ConsentCategory, boolean>>) => {
      if (zone === "none") return true;
      setBusy(true);
      setError(null);
      try {
        const next = await saveConsent(zone, choices);
        if (next) setAnswer(next);
        return true;
      } catch (failure) {
        if (failure instanceof ConsentOutdatedError) {
          // §4: the policy text changed under this bundle. Re-read what the browser holds
          // and ask for a confirmation under the current text instead of pretending the
          // refused choice was stored.
          const fresh = await loadConsent(zone).catch(() => null);
          setAnswer(fresh);
          setError(t("consent.settings.outdated"));
          return false;
        }
        setError(t("consent.settings.failed"));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [t, zone],
  );

  const acknowledge = useCallback(() => {
    // The notice is information, but the server still records the choice (§4): the
    // cookie is what stops the plate from returning, not a local flag.
    void save(bulkChoices(false));
  }, [save]);

  const decide = useCallback(
    async (granted: boolean) => {
      const saved = await save(bulkChoices(granted));
      if (saved) setSettingsOpen(false);
    },
    [save],
  );

  const value = useMemo<ConsentContextValue>(
    () => ({
      view,
      ready,
      surface: held ? "none" : consentSurface(view),
      busy,
      error,
      openSettings: () => {
        setError(null);
        setSettingsOpen(true);
      },
      closeSettings: () => setSettingsOpen(false),
      hold: setHeld,
      save,
      policyHref: compliance.policyUrl ?? "/?legal=cookies",
      personalDataHref: compliance.personalDataConsentUrl,
    }),
    [busy, compliance.personalDataConsentUrl, compliance.policyUrl, error, held, ready, save, view],
  );

  return (
    <ConsentContext.Provider value={value}>
      {children}
      {value.surface === "notice" && (
        <ConsentNotice
          onAcknowledge={acknowledge}
          policyHref={value.policyHref}
          personalDataHref={value.personalDataHref}
        />
      )}
      {value.surface === "banner" && (
        <ConsentBanner
          onAccept={() => void decide(true)}
          onReject={() => void decide(false)}
          onCustomize={() => value.openSettings()}
        />
      )}
      <ConsentSettingsDialog
        open={settingsOpen}
        view={view}
        policyHref={value.policyHref}
        personalDataHref={value.personalDataHref}
        busy={busy}
        error={error}
        onSave={(choices) => {
          void save(choices).then((saved) => {
            if (saved) setSettingsOpen(false);
          });
        }}
        onClose={() => setSettingsOpen(false)}
      />
    </ConsentContext.Provider>
  );
}

/** The choice as the rest of the app reads it; a missing provider is a programming error. */
export function useConsent(): ConsentContextValue {
  const value = useContext(ConsentContext);
  if (!value) throw new Error("useConsent must be used inside <ConsentProvider>");
  return value;
}

/** §6.5: a room calls this while a presentation or a followed view is open. */
export function useConsentHold(active: boolean): void {
  const { hold } = useConsent();
  useEffect(() => {
    hold(active);
    return () => hold(false);
  }, [active, hold]);
}

/** The one name of the settings entry in the footers of the home, help and sign-in (§6.3). */
export function ConsentLink({ className }: { className?: string }) {
  const { t } = useI18n();
  const { openSettings } = useConsent();
  return (
    // «Документы» sits beside «Cookie» (ADR-256 §6): both are public entry points of the
    // installation, and a guest needs neither an account nor a choice to read them.
    <span className={className ? `footer-legal ${className}` : "footer-legal"}>
      <Button variant="ghost" size="compact" onClick={openSettings}>
        {t("consent.link")}
      </Button>
      <a className="footer-legal-link" href="/?legal=documents">
        {t("legal.documents")}
      </a>
    </span>
  );
}
