import { useEffect, useState } from "react";

/**
 * A CSS media query as a boolean, for the few places where the layout changes what is
 * drawn rather than only how it looks.
 *
 * The header below 900 px keeps two faces and hides the agent and comments controls;
 * “+N” has to count the faces that are actually there, which CSS alone cannot do.
 * The stylesheet still owns the visuals: this hook is only for counting.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia(query).matches,
  );

  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);

  return matches;
}
