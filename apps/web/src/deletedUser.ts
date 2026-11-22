/**
 * The one label for a person whose account is a tombstone (ADR-257 §3).
 *
 * The purge clears every copied name, so an empty name is not "unknown": it is a person
 * the installation no longer has. The reader's language supplies the words; the data
 * supplies only the fact.
 */
export function deletedUserName(name: string | null | undefined, label: string): string {
  const value = String(name ?? "").trim();
  return value || label;
}
