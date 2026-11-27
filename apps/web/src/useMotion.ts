import { useEffect, useState } from "react";

/**
 * Calm animations (ADR-265 §4, ADR-266 §8, ADR-289).
 *
 * The choice is an account setting; this browser keeps the last value so a reload
 * without a session does not snap back to springy. It applies the same attribute the
 * painting code already reads for `prefers-reduced-motion`, so there is one switch, not
 * a second animation system.
 */
const KEY = "remo.motion";

export function readCalm(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "calm";
  } catch {
    return false;
  }
}

export function applyCalm(calm: boolean): void {
  if (calm) document.documentElement.dataset.motion = "calm";
  else delete document.documentElement.dataset.motion;
}

export function useCalmMotion() {
  const [calm, setCalmState] = useState(readCalm);

  useEffect(() => {
    applyCalm(calm);
  }, [calm]);

  const setCalm = (next: boolean) => {
    setCalmState(next);
    try {
      window.localStorage.setItem(KEY, next ? "calm" : "off");
    } catch {
      /* private mode: the value still applies for this tab */
    }
  };

  return { calm, setCalm };
}
