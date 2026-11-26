import { FacilitationBody } from "./FacilitationPanel";
import { useState } from "react";
import { formatRemaining, type TimerPhase } from "@remo/model";
import { Button, Input } from "@remo/ui";
import { HelpLink } from "./help/HelpLink";
import { useI18n } from "./i18n";

/**
 * The shared timer's controls (ADR-075).
 *
 * The countdown itself lives on the board object and is painted from `endsAt`; this
 * panel is where a facilitator starts, pauses, extends or resets it. A viewer can open
 * it but sees only the state and who set it — facilitation is a capability, not a
 * hidden button.
 */
export function TimerPanel({
  open,
  phase,
  remainingMs,
  setBy,
  canFacilitate,
  onStart,
  onPause,
  onResume,
  onExtend,
  onReset,
}: {
  open: boolean;
  /** `idle` when there is no timer object yet. */
  phase: TimerPhase;
  remainingMs: number;
  setBy: string;
  canFacilitate: boolean;
  onStart: (minutes: number) => void;
  onPause: () => void;
  onResume: () => void;
  onExtend: () => void;
  onReset: () => void;
}) {
  const { t } = useI18n();
  const [custom, setCustom] = useState(7);
  const presets = [1, 5, 10, 15];
  if (!open) return null;

  const running = phase === "running";
  const paused = phase === "paused";
  const started = phase !== "idle";
  const active = running || paused;
  const minutesLeft = Math.floor(Math.ceil(remainingMs / 1000) / 60);
  const help = <HelpLink topicId="facilitation.timer" />;
  const name = setBy || "—";
  const time = minutesLeft > 0
    ? t("facilitation.timer.minutes", { n: minutesLeft })
    : t("facilitation.timer.lessThanMinute");
  const captions = {
    idle: t("facilitation.timer.idle"),
    expired: t("facilitation.timer.timeUp"),
    paused: t("facilitation.timer.pausedBy", { name }),
    running: t("facilitation.timer.setBy", { name, time }),
  };

  return (
    <FacilitationBody
      title={active ? undefined : t("facilitation.timer.title")}
      description={active ? undefined : t("facilitation.timer.body")}
      help={help}
    >
      <section className="dialog-stack timer-dialog">

        <div className={`timer-face ${phase}`}>
          <strong>{formatRemaining(remainingMs)}</strong>
          <div className="timer-caption">
            <span>{captions[phase]}</span>
            {active && help}
          </div>
        </div>

        {!canFacilitate ? (
          <p className="muted">{t("facilitation.timer.readOnly")}</p>
        ) : (
          <>
            {started && (
              <div className="timer-actions">
                {running && (
                  <Button variant="secondary" onClick={onPause}>
                    {t("facilitation.timer.pause")}
                  </Button>
                )}
                {paused && (
                  <Button variant="secondary" onClick={onResume}>
                    {t("facilitation.timer.resume")}
                  </Button>
                )}
                <Button variant="secondary" onClick={onExtend}>
                  {t("facilitation.timer.extend")}
                </Button>
                <Button variant="secondary" onClick={onReset}>
                  {t("facilitation.timer.reset")}
                </Button>
              </div>
            )}

            {!running && !paused && (
              <section className="timer-section">
                <h3>{started ? t("facilitation.timer.restart") : t("facilitation.timer.start")}</h3>
                <div className="timer-presets">
                  {presets.map((minutes) => (
                    <Button
                      key={minutes}
                      onClick={() => onStart(minutes)}
                    >
                      {t("facilitation.timer.minutes", { n: minutes })}
                    </Button>
                  ))}
                </div>
                <div className="timer-custom">
                  <Input
                    label={t("facilitation.timer.custom")}
                    type="number"
                    min={1}
                    max={1440}
                    value={custom}
                    onChange={(event) => setCustom(Number(event.target.value) || 1)}
                  />
                  <Button variant="primary" onClick={() => onStart(custom)}>
                    {t("facilitation.timer.start")}
                  </Button>
                </div>
                <p className="muted">{t("facilitation.timer.startHint")}</p>
              </section>
            )}
          </>
        )}
      </section>
    </FacilitationBody>
  );
}
