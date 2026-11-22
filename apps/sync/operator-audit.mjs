/**
 * One audit row for an operator action, whichever surface wrote it (ADR-262 §3.1 rule 5,
 * `spec/operator-actions.md` §3.1 п. 5).
 *
 * The shell and the console are two doors into the same act, so the row has one shape:
 * who, what, why, **from where** (`channel`) and **what proved the person** (`mfa`). The
 * columns live on `audit_events` (schema 36) rather than in `after`, because the console
 * journal filters on them and a JSON field cannot be indexed without a second mechanism.
 *
 * A row written by the product itself (a webhook, a scheduled job) calls `recordAudit`
 * directly and carries neither field: `null` there means "not an operator action", not
 * "an operator action whose origin is unknown".
 */
export const OPERATOR_CHANNELS = Object.freeze(["cli", "console"]);
export const OPERATOR_FACTORS = Object.freeze(["totp", "recovery"]);

/**
 * @param {{ channel: "cli"|"console", mfa?: "totp"|"recovery"|null }} origin
 * @param {Record<string, unknown>} event the same shape `recordAudit` takes
 */
export function operatorAudit({ channel, mfa = null, ...event }) {
  if (!OPERATOR_CHANNELS.includes(channel)) {
    throw new Error("an operator audit row names its channel: cli or console");
  }
  if (mfa !== null && !OPERATOR_FACTORS.includes(mfa)) {
    throw new Error("an operator audit row names the factor: totp, recovery or null");
  }
  return { ...event, channel, mfa };
}
