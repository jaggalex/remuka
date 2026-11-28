/**
 * A refused command: a stable code, a message and an HTTP status (ADR-092).
 *
 * Kept apart from the registry so feature modules (two-sided notes, ADR-320) can throw
 * the same error without importing the whole command table.
 */
export class CommandError extends Error {
  constructor(code, message, status = 422) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
