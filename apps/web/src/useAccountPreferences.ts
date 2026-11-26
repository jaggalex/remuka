import { useEffect, useRef } from "react";
import { api, type SessionUser } from "./api";
import type { Lang } from "./i18n";
import type { Theme } from "./useTheme";

type AccountPreferences = NonNullable<SessionUser["preferences"]>;

const LANGS = new Set<Lang>(["ru", "en"]);

function serverTheme(preferences: AccountPreferences | undefined): Theme | null {
  const value = preferences?.theme;
  return value === "dark" || value === "light" || value === "system" ? value : null;
}

function serverLang(preferences: AccountPreferences | undefined): Lang | null {
  const value = preferences?.lang;
  return value && LANGS.has(value) ? value : null;
}

function serverCalm(preferences: AccountPreferences | undefined): boolean | null {
  const value = preferences?.motion;
  return typeof value === "boolean" ? value : null;
}

/**
 * Theme, language and "calm animations" follow the account (ADR-150, ADR-266 §8).
 *
 * Before sign-in the local choice applies; when the account has values they win, and
 * when it has none the browser's current choice seeds the account. A change made while
 * signed in is written back once. The browser copy stays, so sign-out and a reload
 * without a session still read a sensible value. Motion is the third preference and
 * uses the same path — a second mechanism would let the two drift (ADR-289).
 */
export function useAccountPreferences({
  me,
  theme,
  setTheme,
  lang,
  setLang,
  calm,
  setCalm,
}: {
  me: SessionUser | null;
  theme: Theme;
  setTheme: (value: Theme) => void;
  lang: Lang;
  setLang: (value: Lang) => void;
  calm: boolean;
  setCalm: (value: boolean) => void;
}) {
  /** What this account is known to hold, and whether the local state has caught up. */
  const known = useRef<{
    id: string;
    theme: Theme;
    lang: Lang;
    calm: boolean;
    ready: boolean;
  } | null>(null);
  const local = useRef({ theme, lang, calm });
  local.current = { theme, lang, calm };

  useEffect(() => {
    if (!me) {
      known.current = null;
      return;
    }
    const storedTheme = serverTheme(me.preferences);
    const storedLang = serverLang(me.preferences);
    const storedCalm = serverCalm(me.preferences);
    const nextTheme = storedTheme ?? local.current.theme;
    const nextLang = storedLang ?? local.current.lang;
    const nextCalm = storedCalm ?? local.current.calm;
    known.current = { id: me.id, theme: nextTheme, lang: nextLang, calm: nextCalm, ready: false };

    if (nextTheme !== local.current.theme) setTheme(nextTheme);
    if (nextLang !== local.current.lang) setLang(nextLang);
    if (nextCalm !== local.current.calm) setCalm(nextCalm);

    // An account created before this feature has no values. Its first signed-in browser
    // hands over the choice it already shows instead of resetting the person to defaults.
    if (storedTheme === null || storedLang === null || storedCalm === null) {
      void api
        .updatePreferences({ theme: nextTheme, lang: nextLang, motion: nextCalm })
        .catch(() => {
          /* the local choice still applies; a later change writes again */
        });
    }
    // `me.id` is the sign-in boundary: a fresh `me` object for the same account must not
    // re-apply stored values over a change the person just made.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.id]);

  useEffect(() => {
    const current = known.current;
    if (!me || !current || current.id !== me.id) return;
    // Wait until the local state equals what the sign-in effect applied or seeded, so
    // the old value is never written back over the account's value.
    if (!current.ready) {
      if (current.theme === theme && current.lang === lang && current.calm === calm) {
        current.ready = true;
      }
      return;
    }
    if (current.theme === theme && current.lang === lang && current.calm === calm) return;
    current.theme = theme;
    current.lang = lang;
    current.calm = calm;
    void api.updatePreferences({ theme, lang, motion: calm }).catch(() => {
      /* keep the local choice; the next change retries the write */
    });
  }, [me, theme, lang, calm]);
}
