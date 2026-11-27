/**
 * The blocking acceptance window and the account-side legal state (ADR-256 §5).
 *
 * The provider reads `GET /account/legal` after the page mounts and again whenever a
 * session appears. A document with `reaccept: true` whose current revision is not the
 * person's latest accepted one makes the window appear; it has no close button, no
 * Escape and no backdrop dismissal. The only ways out are «Принять» — which writes the
 * rows and asks the server again — and «Выйти», which ends the session.
 *
 * The page behind the window stays mounted, so a room keeps its document and reconnect
 * state; it is unreachable, not unmounted. A guest gets a 401, which is not an error:
 * there is nothing for a guest to accept.
 */
import { LegalChanges } from "./LegalChanges";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Button, Dialog } from "@remo/ui";
import { api, ApiError, call } from "../api";
import { roomFromUrl } from "../identity";
import { useI18n } from "../i18n";
import { LegalConsent } from "./LegalConsent";
import { LegalUpcomingBanner } from "./LegalUpcomingBanner";
import {
  acceptAccountLegal,
  loadAccountLegal,
  withdrawAccountLegal,
  type AccountLegal,
  type LegalAcceptanceInput,
  type LegalDocumentState,
} from "./accountLegal";
import { subscribeLegalSession } from "./legalSession";

interface LegalContextValue {
  /** Null for a guest, an older service, or a failed read with no session. */
  readonly account: AccountLegal | null;
  readonly ready: boolean;
  readonly busy: boolean;
  readonly error: string | null;
  refresh: () => Promise<AccountLegal | null>;
  accept: (acceptances: readonly LegalAcceptanceInput[]) => Promise<"ok" | "changed" | "failed">;
  withdraw: (doc: string) => Promise<boolean>;
}

const LegalContext = createContext<LegalContextValue | null>(null);

function isAuthError(failure: unknown): boolean {
  return failure instanceof ApiError && failure.status === 401;
}

/** The re-acceptance window: a real dialog that cannot be dismissed (§5). */
function ReacceptDialog({
  documents,
  all,
  busy,
  error,
  roomId,
  onAccept,
  onSignOut,
}: {
  documents: readonly LegalDocumentState[];
  all: readonly LegalDocumentState[];
  busy: boolean;
  error: string | null;
  roomId: string | null;
  onAccept: (acceptances: LegalAcceptanceInput[]) => void;
  onSignOut: () => void;
}) {
  const { t } = useI18n();
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupError, setBackupError] = useState(false);
  const complete = documents.every((document) => checked[document.doc]);

  /**
   * §5: «данные не блокируются». A room backup is a read grant, so the window offers it
   * without closing: the dialog stays, the download starts behind it.
   */
  const downloadBackup = async () => {
    if (!roomId || backupBusy) return;
    setBackupBusy(true);
    setBackupError(false);
    try {
      const { blob, filename } = await api.downloadBackup(roomId);
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = filename;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
    } catch {
      setBackupError(true);
    } finally {
      setBackupBusy(false);
    }
  };

  return (
    <Dialog
      title={t("legal.reaccept.title")}
      description={t("legal.reaccept.intro")}
      size="md"
      // §5: the window must not be closable without a decision; there is no X, Escape or
      // scrim click, and `onClose` is deliberately absent.
      dismissable={false}
      footer={
        <>
          {roomId && (
            <Button
              variant="secondary"
              loading={backupBusy}
              onClick={() => void downloadBackup()}
            >
              {t("legal.reaccept.backup")}
            </Button>
          )}
          <Button variant="secondary" onClick={onSignOut}>
            {t("legal.reaccept.signOut")}
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!complete}
            onClick={() =>
              onAccept(
                documents.map(({ doc, version, sha256 }) => ({ doc, version, sha256 })),
              )
            }
          >
            {t("legal.reaccept.accept")}
          </Button>
        </>
      }
    >
      {documents.map(document => <LegalChanges key={document.doc} document={document} />)}
      <LegalConsent
        idPrefix="legal-reaccept"
        documents={documents}
        all={all}
        checked={checked}
        onChange={(doc, value) => setChecked((current) => ({ ...current, [doc]: value }))}
        error={error}
      />
      {backupError && <p className="auth-error">{t("legal.reaccept.backupFailed")}</p>}
    </Dialog>
  );
}

export function LegalProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [account, setAccount] = useState<AccountLegal | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await loadAccountLegal();
      setAccount(next);
      return next;
    } catch (failure) {
      // A guest is the normal case of a public page, not a failure to show.
      if (!isAuthError(failure)) setError(t("legal.page.failed"));
      setAccount(null);
      return null;
    } finally {
      setReady(true);
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    return subscribeLegalSession(() => {
      void refresh();
    });
  }, [refresh]);

  const accept = useCallback(
    async (acceptances: readonly LegalAcceptanceInput[]) => {
      setBusy(true);
      setError(null);
      try {
        const next = await acceptAccountLegal(acceptances);
        setAccount(next);
        return "ok" as const;
      } catch (failure) {
        const code = failure instanceof ApiError ? failure.code : "";
        if (code === "LEGAL_VERSION_CHANGED" || code === "LEGAL_ACCEPTANCE_REQUIRED") {
          // The registry moved under the open form: re-read it and let the person see the
          // current revision instead of retrying the refused one.
          setError(t("legal.register.changed"));
          await refresh();
          return "changed" as const;
        }
        setError(t("legal.reaccept.failed"));
        return "failed" as const;
      } finally {
        setBusy(false);
      }
    },
    [refresh, t],
  );

  const withdraw = useCallback(async (doc: string) => {
    setBusy(true);
    setError(null);
    try {
      const next = await withdrawAccountLegal(doc);
      setAccount(next);
      return true;
    } catch {
      setError(t("legal.withdraw.failed"));
      return false;
    } finally {
      setBusy(false);
    }
  }, [t]);

  const signOut = useCallback(() => {
    void call<{ ok: true }>("/auth/logout", { method: "POST" })
      .catch(() => null)
      .finally(() => window.location.assign("/"));
  }, []);

  const value = useMemo<LegalContextValue>(
    () => ({ account, ready, busy, error, refresh, accept, withdraw }),
    [account, ready, busy, error, refresh, accept, withdraw],
  );

  const pending = (account?.documents ?? []).filter((document) => document.pending);

  return (
    <LegalContext.Provider value={value}>
      <LegalUpcomingBanner documents={account?.documents ?? []} />
      {children}
      {pending.length > 0 && (
        <ReacceptDialog
          key={pending.map((document) => `${document.doc}@${document.version}:${document.sha256}`).join("|")}
          documents={pending}
          all={account?.documents ?? []}
          busy={busy}
          error={error}
          roomId={roomFromUrl()}
          onAccept={(acceptances) => void accept(acceptances)}
          onSignOut={signOut}
        />
      )}
    </LegalContext.Provider>
  );
}

export function useLegalAccount(): LegalContextValue {
  const value = useContext(LegalContext);
  if (!value) throw new Error("useLegalAccount must be used inside <LegalProvider>");
  return value;
}
