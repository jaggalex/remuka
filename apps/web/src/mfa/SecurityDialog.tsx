import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Dialog, Input } from "@remo/ui";
import { formatDateTime } from "../format";
import { useI18n } from "../i18n";
import { MfaCodes } from "./MfaCodes";
import { MfaEnrollment } from "./MfaEnrollment";
import { mfaApi, type MfaStatus } from "./mfaApi";
import { mfaErrorText } from "./mfaError";

/**
 * «Настройки аккаунта → Безопасность → Двухфакторный вход» (`spec/totp.md` §4, §7).
 *
 * The dialog is the account's own screen: it reads status, turns the factor on, replaces
 * the recovery codes and — for an account without the operator role — turns it off. Each
 * change that removes a protection asks for a current code, so a stolen session alone can
 * neither replace the secret nor print codes.
 */
type View = "status" | "enroll" | "regen" | "disable";

export function SecurityDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, lang } = useI18n();
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [view, setView] = useState<View>("status");
  const [code, setCode] = useState("");
  const [fresh, setFresh] = useState<string[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setStatus(await mfaApi.status());
    } catch {
      setError(t("mfa.failed"));
    }
  }, [t]);

  useEffect(() => {
    if (!open) return;
    setView("status");
    setFresh(null);
    setNotice(null);
    setCode("");
    void load();
  }, [open, load]);

  if (!open) return null;

  const submitCode = async (action: "regen" | "disable") => {
    if (!code || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (action === "regen") {
        const result = await mfaApi.regenerate(code);
        setFresh(result.recoveryCodes);
        setNotice(t("mfa.regenerated"));
        setView("status");
      } else {
        await mfaApi.disable(code);
        setNotice(t("mfa.disabled"));
        setView("status");
      }
      setCode("");
      await load();
    } catch (failure) {
      setError(mfaErrorText(failure, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title={t("mfa.title")} description={t("mfa.description")} size="sm" onClose={onClose}>
      <div className="mfa-stack">
        {error && <p className="auth-error">{error}</p>}
        {notice && <p className="mfa-note">{notice}</p>}

        {view === "enroll" ? (
          <MfaEnrollment
            onDone={() => {
              setView("status");
              void load();
            }}
          />
        ) : status === null ? (
          <p className="mfa-note">{error ? t("mfa.failed") : t("mfa.loading")}</p>
        ) : (
          <>
            <div className="mfa-status">
              <Badge tone={status.enrolled ? "success" : "info"}>
                {status.enrolled
                  ? t("mfa.on", {
                      date: formatDateTime(status.confirmedAt ?? "", lang),
                    })
                  : t("mfa.off")}
              </Badge>
              {status.enrolled && (
                <span className="mfa-note">{t("mfa.recoveryLeft", { n: status.recoveryLeft })}</span>
              )}
            </div>
            {status.enrolled && status.recoveryLeft < 3 && (
              <p className="auth-error">{t("mfa.recoveryLow")}</p>
            )}
            {!status.enrolled && status.pending && <p className="mfa-note">{t("mfa.pending")}</p>}

            {!status.enrolled && (
              <div className="mfa-actions">
                <Button variant="primary" onClick={() => setView("enroll")}>
                  {status.pending ? t("mfa.restart") : t("mfa.begin")}
                </Button>
              </div>
            )}

            {status.enrolled && (
              <>
                <div className="mfa-actions">
                  <Button variant="secondary" onClick={() => setView(view === "regen" ? "status" : "regen")}>
                    {t("mfa.regen")}
                  </Button>
                  <Button variant="ghost" onClick={() => setView(view === "disable" ? "status" : "disable")}>
                    {t("mfa.disable")}
                  </Button>
                </div>
                {view === "regen" && (
                  <form
                    className="mfa-stack"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void submitCode("regen");
                    }}
                  >
                    <p className="mfa-note">{t("mfa.regenHint")}</p>
                    <Input
                      label={t("mfa.code")}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      value={code}
                      onChange={(event) => setCode(event.currentTarget.value.replace(/\s/g, ""))}
                    />
                    <div className="mfa-actions">
                      <Button type="submit" variant="primary" loading={busy} disabled={code.length !== 6}>
                        {t("mfa.confirm")}
                      </Button>
                    </div>
                  </form>
                )}
                {view === "disable" && (
                  <form
                    className="mfa-stack"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void submitCode("disable");
                    }}
                  >
                    <p className="mfa-note">{t("mfa.disableHint")}</p>
                    <Input
                      label={t("mfa.code")}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      value={code}
                      onChange={(event) => setCode(event.currentTarget.value.replace(/\s/g, ""))}
                    />
                    <div className="mfa-actions">
                      <Button type="submit" variant="danger" loading={busy} disabled={code.length !== 6}>
                        {t("mfa.disable")}
                      </Button>
                    </div>
                  </form>
                )}
                {fresh && (
                  <>
                    <p className="mfa-note">{t("mfa.codesHint")}</p>
                    <MfaCodes codes={fresh} />
                    <div className="mfa-actions">
                      <Button
                        variant="primary"
                        onClick={() => {
                          setFresh(null);
                          setView("status");
                        }}
                      >
                        {t("mfa.done")}
                      </Button>
                    </div>
                  </>
                )}
              </>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
