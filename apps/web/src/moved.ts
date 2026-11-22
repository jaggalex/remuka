/**
 * Moving an open tab to the new public address (ADR-254 §6).
 *
 * The sync service closes a socket on a retired origin with `4001` and
 * `moved:<origin>`. A socket close is the only signal an already-open page can act on:
 * a 301 never reaches it, and a PWA does not migrate by itself. The page shows one
 * short banner, then reloads the *same* path and query on the new origin, so a room
 * link survives the move.
 *
 * The decision is a pure function (`movedUrl`) plus one small effect (`followMoved`),
 * because the reload is the only part that needs a browser.
 */

/** How long the “Переезд” banner stays before the reload; one message, not a dialog. */
export const MOVED_BANNER_MS = 1500;

type LocationLike = {
  pathname: string;
  search: string;
  hash?: string;
};

/**
 * The new address, keeping this page's path, query and fragment.
 *
 * A target carries only an origin; a path in it is not a place this page knows, so it
 * is replaced. `null` means the target was not a usable http(s) origin.
 */
export function movedUrl(target: string, location: LocationLike): string | null {
  let next: URL;
  try {
    next = new URL(target);
  } catch {
    return null;
  }
  if (next.protocol !== "http:" && next.protocol !== "https:") return null;
  next.pathname = location.pathname || "/";
  next.search = location.search ?? "";
  next.hash = location.hash ?? "";
  return next.toString();
}

type FollowOptions = {
  location?: LocationLike;
  /** The banner is transient; the reload waits just long enough to be read. */
  delay?: number;
  schedule?: (run: () => void, milliseconds: number) => unknown;
  replace?: (url: string) => void;
};

/**
 * Banner, then move. Returns the URL that will be opened, or `null` when there is
 * nothing to open (an older server or a broken reason): the caller still shows the
 * move notice, but the page stays where it is.
 */
export function followMoved(
  target: string | null,
  options: FollowOptions = {},
): string | null {
  if (!target) return null;
  // Validate the target before touching a browser global: an unusable reason must be
  // answerable in a test and on the server, not by a ReferenceError.
  if (!movedUrl(target, { pathname: "/", search: "" })) return null;
  const url = movedUrl(target, options.location ?? window.location);
  if (!url) return null;
  const schedule =
    options.schedule ?? ((run: () => void, milliseconds: number) => window.setTimeout(run, milliseconds));
  const replace = options.replace ?? ((next: string) => window.location.replace(next));
  schedule(() => replace(url), options.delay ?? MOVED_BANNER_MS);
  return url;
}
