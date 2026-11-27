import { useEffect, useState } from "react";

/** Only an explicit system preference follows the OS (ADR-270). */
export type Theme = "light" | "dark" | "system";
const DARK_QUERY = "(prefers-color-scheme: dark)";

const KEY = "remo.theme";

export function readTheme(): Theme {
  try {
    const stored = window.localStorage.getItem(KEY);
    return stored === "dark" || stored === "system" ? stored : "light";
  } catch {
    return "light";
  }
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(readTheme);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia(DARK_QUERY).matches);
  const resolved = theme === "system" ? (systemDark ? "dark" : "light") : theme;

  useEffect(() => {
    if (theme !== "system") return;
    const media = window.matchMedia(DARK_QUERY);
    const sync = () => setSystemDark(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [theme]);

  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
  }, [resolved]);

  const setTheme = (next: Theme) => {
    setThemeState(next);
    try {
      window.localStorage.setItem(KEY, next);
    } catch {
      /* private mode: the theme still applies for this tab */
    }
  };

  return { theme, resolved, setTheme };
}
