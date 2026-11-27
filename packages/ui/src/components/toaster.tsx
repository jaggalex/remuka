import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useUiStrings } from "../i18n";
import type { IconName } from "../icons";
import { Toast } from "./overlays";

/**
 * Floating messages: one place in the corner of the screen where every page puts what
 * happened and what to do about it (ADR-319).
 *
 * The rules are the ones the `Toast` primitive already states, made into behaviour:
 *
 * - a stack in one viewport — top right under the top bar, full width on a phone;
 *   newest on top, at most three visible, the rest wait their turn;
 * - feedback (neutral, info, success) leaves by itself after 5 s; a warning or an error
 *   stays until it is closed or its cause is gone (`duration: null`);
 * - the timer pauses while the pointer or the focus is on the stack, so nothing leaves
 *   while it is being read or acted on;
 * - an `id` makes a message idempotent: showing it again updates it in place, and the
 *   owner of a persistent message dismisses it by the same id;
 * - the region is a polite live region; an error is assertive (the `Toast` role).
 *
 * Motion is a short slide and fade (`--dur-2`, `--ease`); with reduced motion only the
 * opacity changes.
 */

export type ToastTone = "neutral" | "info" | "success" | "warning" | "danger";

export interface ToastOptions {
  /** Stable key: the same id replaces the message instead of stacking a second one. */
  id?: string;
  tone?: ToastTone;
  /** The kind of event as a picture (a card for money, a speech bubble for support…). */
  icon?: IconName;
  title?: string;
  body?: ReactNode;
  action?: { label: string; onClick: () => void };
  /** Milliseconds; `null` keeps it until closed. Defaults: 5 s, warnings and errors stay. */
  duration?: number | null;
  /** Called when the person closes it (not when the owner dismisses it). */
  onClose?: () => void;
  /** Hide the close button: for a message only its cause can clear. */
  persistent?: boolean;
}

interface Entry extends Required<Pick<ToastOptions, "id" | "tone">> {
  options: ToastOptions;
  leaving: boolean;
  remaining: number | null;
}

interface ToastApi {
  show: (options: ToastOptions) => string;
  dismiss: (id: string) => void;
}

export const TOAST_LIMIT = 3;
export const TOAST_DURATION_MS = 5000;
const LEAVE_MS = 180;

/** Feedback leaves on its own; a problem waits for a person. */
export function defaultToastDuration(tone: ToastTone): number | null {
  return tone === "warning" || tone === "danger" ? null : TOAST_DURATION_MS;
}

const ToastContext = createContext<ToastApi | null>(null);

let sequence = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useUiStrings();
  const [entries, setEntries] = useState<Entry[]>([]);
  const timers = useRef(new Map<string, { handle: ReturnType<typeof setTimeout>; started: number }>());
  const [paused, setPaused] = useState(false);

  const clearTimer = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer.handle);
    timers.current.delete(id);
  }, []);

  const remove = useCallback((id: string) => {
    clearTimer(id);
    setEntries((list) => list.map((entry) => (entry.id === id ? { ...entry, leaving: true } : entry)));
    setTimeout(() => setEntries((list) => list.filter((entry) => entry.id !== id || !entry.leaving)), LEAVE_MS);
  }, [clearTimer]);

  const show = useCallback((options: ToastOptions) => {
    const id = options.id ?? `toast-${(sequence += 1)}`;
    const tone = options.tone ?? "neutral";
    const duration = options.duration === undefined ? defaultToastDuration(tone) : options.duration;
    clearTimer(id);
    setEntries((list) => {
      const next: Entry = { id, tone, options, leaving: false, remaining: duration };
      const index = list.findIndex((entry) => entry.id === id);
      if (index >= 0) return list.map((entry, at) => (at === index ? next : entry));
      return [next, ...list];
    });
    return id;
  }, [clearTimer]);

  // Timers run only for visible, unpaused messages; a paused one keeps what it had left.
  useEffect(() => {
    const visible = entries.filter((entry) => !entry.leaving).slice(0, TOAST_LIMIT);
    for (const entry of visible) {
      if (entry.remaining === null) continue;
      if (paused) {
        const timer = timers.current.get(entry.id);
        if (timer) {
          clearTimer(entry.id);
          const left = Math.max(0, (entry.remaining ?? 0) - (Date.now() - timer.started));
          setEntries((list) => list.map((item) => (item.id === entry.id ? { ...item, remaining: left } : item)));
        }
        continue;
      }
      if (timers.current.has(entry.id)) continue;
      const handle = setTimeout(() => remove(entry.id), entry.remaining);
      timers.current.set(entry.id, { handle, started: Date.now() });
    }
  }, [entries, paused, remove, clearTimer]);

  useEffect(() => () => {
    for (const timer of timers.current.values()) clearTimeout(timer.handle);
  }, []);

  const api = useMemo<ToastApi>(() => ({ show, dismiss: remove }), [show, remove]);
  const active = entries.filter((entry) => !entry.leaving).slice(0, TOAST_LIMIT);
  const visible = entries.filter((entry) => entry.leaving || active.includes(entry));

  return (
    <ToastContext.Provider value={api}>
      {children}
      <section
        className="rm-toaster"
        aria-label={t("notifications")}
        onPointerEnter={() => setPaused(true)}
        onPointerLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPaused(false);
        }}
      >
        {visible.map((entry) => {
          const { options } = entry;
          return (
            <div key={entry.id} className="rm-toaster-item" data-leaving={entry.leaving ? "" : undefined} data-toast-id={entry.id}>
              <Toast
                tone={entry.tone}
                icon={options.icon}
                title={options.title}
                action={options.action ? {
                  label: options.action.label,
                  onClick: () => {
                    options.action?.onClick();
                    if (entry.remaining !== null) remove(entry.id);
                  },
                } : undefined}
                onClose={options.persistent ? undefined : () => { options.onClose?.(); remove(entry.id); }}
              >
                {options.body}
              </Toast>
            </div>
          );
        })}
      </section>
    </ToastContext.Provider>
  );
}

const NOOP: ToastApi = { show: (options) => options.id ?? "", dismiss: () => {} };

/** The page's toaster; outside a `ToastProvider` it does nothing rather than throw. */
export function useToast(): ToastApi {
  return useContext(ToastContext) ?? NOOP;
}
