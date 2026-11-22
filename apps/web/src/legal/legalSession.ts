/**
 * A one-line signal that a session appeared (ADR-256 §5).
 *
 * `AuthDialog` is mounted deep inside the home and the room; the legal provider sits above
 * both. Rather than drill a callback through screens that must not grow, the dialog says
 * "there is a session now" and the provider asks the server what that session owes.
 * Nothing is stored: the server's journal is the only state.
 */
const listeners = new Set<() => void>();

/** Call after a successful sign-in or registration. */
export function announceLegalSession(): void {
  for (const listener of [...listeners]) listener();
}

export function subscribeLegalSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
