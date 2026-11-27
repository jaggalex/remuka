import { useToast, type IconName, type ToastOptions, type ToastTone } from "@remo/ui";
import { useCallback } from "react";

/**
 * Floating messages of the product: one class of solution for every event a person must
 * notice wherever they are — a payment problem, a reply from support, a colleague waiting
 * in a room (ADR-319). The kind decides the picture, the tone and how long it stays; the
 * caller supplies only the words and, at most, one action.
 *
 * | kind     | icon     | tone    | stays                    | example                                     |
 * | -------- | -------- | ------- | ------------------------ | ------------------------------------------- |
 * | info     | info     | neutral | 5 s                      | «Ссылка скопирована»                        |
 * | success  | check    | success | 5 s                      | «Изменение отменено. Team продолжится…»     |
 * | warning  | alert    | warning | until closed             | a limit is near                             |
 * | error    | error    | danger  | until closed             | a save failed, with «Повторить»             |
 * | billing  | budget   | warning | until closed or resolved | «Оплата за Team не прошла…» · Обновить карту |
 * | support  | comment  | info    | until closed or opened   | «Пришёл ответ от поддержки» · Открыть        |
 * | presence | users    | info    | 10 s                     | «Аня ждёт вас в «Ретро», перейти?» · Перейти |
 *
 * A message about a state (billing, support) has a stable `id`: showing it again updates
 * it, and its owner dismisses it when the state is gone. Words come from i18n and follow
 * the voice of `remuka-voice`; the kind never adds words of its own.
 */
export type NoticeKind = "info" | "success" | "warning" | "error" | "billing" | "support" | "presence";

interface KindStyle {
  icon: IconName;
  tone: ToastTone;
  /** `null`: until closed. */
  duration: number | null;
}

export const NOTICE_KINDS: Record<NoticeKind, KindStyle> = {
  info: { icon: "info", tone: "neutral", duration: 5000 },
  success: { icon: "check", tone: "success", duration: 5000 },
  warning: { icon: "alert", tone: "warning", duration: null },
  error: { icon: "error", tone: "danger", duration: null },
  billing: { icon: "budget", tone: "warning", duration: null },
  support: { icon: "comment", tone: "info", duration: null },
  presence: { icon: "users", tone: "info", duration: 10_000 },
};

export type NoticeOptions = Omit<ToastOptions, "icon" | "tone"> & { tone?: ToastTone };

/** `notify(kind, message)` and `dismiss(id)`: the one way pages raise a floating message. */
export function useNotices() {
  const toast = useToast();
  const notify = useCallback((kind: NoticeKind, options: NoticeOptions) => {
    const style = NOTICE_KINDS[kind];
    return toast.show({
      ...options,
      icon: style.icon,
      tone: options.tone ?? style.tone,
      duration: options.duration === undefined ? style.duration : options.duration,
    });
  }, [toast]);
  return { notify, dismiss: toast.dismiss };
}
