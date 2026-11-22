/**
 * The second factor for operator commands run from the shell (ADR-262 §5,
 * `spec/operator-actions.md` §5).
 *
 * Money and measures used to be protected by shell access alone, but several people can
 * share one server account: `--as` said who was acting without proving it. The commands
 * that move money or restrict a customer now ask for the acting operator's code, checked
 * by the same `verifyMfaCode`/`matchTotp` path as sign-in — one accepted step, recovery
 * codes consumed once, five wrong answers closing the commands for fifteen minutes.
 *
 * The failures are rows in `mfa_cli_attempts`, not a counter in this process: every
 * `pnpm billing:*` invocation is a new process, so a map in memory forgot every wrong code
 * between runs and the lock never spanned them (D1 in `spec/stage-operator-acceptance.md`).
 * The database is the counter, a correct code clears the operator's rows, and the existing
 * hourly retention pass drops rows older than the window.
 *
 * `operator:grant/revoke` and `mfa:reset` deliberately do not ask for a code: they are how
 * access is restored when the factor is gone, and the server is their trust anchor.
 *
 * A stand may switch the check off with `REMO_OPERATOR_CLI_MFA=0`, and only when
 * `REMO_STAGE=1` marks it as a stand (ADR-261, `spec/stage.md` §5): a production
 * installation ignores the variable.
 */
import { createInterface } from "node:readline/promises";
import {
  MFA_CLI_ATTEMPTS,
  MFA_CLI_LOCK_MS,
  normalizeRecoveryCode,
} from "./mfa.mjs";
import { kekFromEnv } from "./secrets.mjs";
import { isStage } from "./stage.mjs";

/** Five wrong codes in a row, then the command group is closed for this operator. */
export const CLI_MFA_ATTEMPTS = MFA_CLI_ATTEMPTS;
export const CLI_MFA_LOCK_MS = MFA_CLI_LOCK_MS;

/** The commands that change money or restrict a customer (ADR-262 §5). */
export const CLI_MFA_COMMANDS = Object.freeze([
  "billing:refund",
  "billing:credit",
  "billing:grant",
  "billing:mark-paid",
  "abuse:link-disable",
  "abuse:board-hide",
  "abuse:org-suspend",
  "abuse:revert",
]);

export function cliMfaRequired(command) {
  return CLI_MFA_COMMANDS.includes(command);
}

/**
 * `REMO_OPERATOR_CLI_MFA=0` is honoured only on a stand: `REMO_STAGE=1` is the flag that
 * says "this installation holds test data" (ADR-261), and nowhere else.
 */
export function operatorCliMfaDisabled(env = process.env) {
  const wanted = String(env.REMO_OPERATOR_CLI_MFA ?? "").trim();
  return wanted === "0" && isStage(env);
}

/** An error the caller prints and turns into exit code 1; the message is the whole story. */
function cliMfaError(message, code = "MFA_REQUIRED") {
  const error = new Error(message);
  error.code = code;
  return error;
}

/** The one sentence for a closed group, whether the fifth row was just written or not. */
function lockedMessage() {
  return "five wrong codes: money and measure commands are closed for this operator for 15 minutes";
}

/** The prompt is a terminal; a pipeline needs `--code` because nobody can answer. */
export function cliIsInteractive(stdin = process.stdin) {
  return Boolean(stdin?.isTTY);
}

/** One line from the terminal; the code is six digits and is not a secret to hide here. */
export async function askCliCode({ stdin = process.stdin, stdout = process.stderr } = {}) {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return await rl.question("Code from the authenticator app: ");
  } finally {
    rl.close();
  }
}

/**
 * Prove the acting operator and return what proved them.
 *
 * @returns {Promise<{ mfa: "totp"|"recovery"|null, remaining?: number|null, skipped: boolean }>}
 * @throws an error with `code = "MFA_REQUIRED"` when the command must not run
 */
export async function assertOperatorCliMfa({
  store,
  actor,
  code = null,
  env = process.env,
  kek = undefined,
  stdin = process.stdin,
  stdout = process.stderr,
  ask = askCliCode,
  now = () => new Date(),
} = {}) {
  if (!actor?.id) throw cliMfaError("the operator could not be resolved; nothing was done");
  if (operatorCliMfaDisabled(env)) return { mfa: null, skipped: true };

  const at = now();
  // The lock starts at the fifth wrong answer, not the first: five rows inside the window
  // close the group, and the fifth row's own `at` is when the window begins to expire.
  const since = new Date(at.getTime() - CLI_MFA_LOCK_MS);
  const failures = await store.countCliMfaFailures({ userId: actor.id, since });
  if (failures >= CLI_MFA_ATTEMPTS) throw cliMfaError(lockedMessage(), "MFA_LOCKED");

  const status = await store.mfaStatus?.(actor.id);
  if (!status?.enrolled) {
    throw cliMfaError(
      `operator ${actor.email ?? actor.id} has no confirmed second factor; enrol one in Account → Security first`,
      "MFA_NOT_ENROLLED",
    );
  }

  let presented = String(code ?? "").trim();
  if (!presented) {
    if (!cliIsInteractive(stdin)) {
      throw cliMfaError(
        "--code <six digits> is required: this command asks for the operator's second factor and a pipeline cannot answer",
      );
    }
    presented = String((await ask({ stdin, stdout })) ?? "").trim();
  }
  if (!presented) {
    throw cliMfaError("no code was entered; nothing was done");
  }

  const recovery = normalizeRecoveryCode(presented) !== null;
  let verified;
  if (recovery) {
    verified = await store.verifyMfaRecoveryCode({ userId: actor.id, code: presented });
  } else {
    const keying = kek ?? kekFromEnv(env);
    if (!keying) {
      throw cliMfaError(
        "the key-encryption key is not configured, so the code cannot be checked",
        "MFA_UNAVAILABLE",
      );
    }
    verified = await store.verifyMfaCode({
      userId: actor.id,
      code: presented,
      kek: keying,
      now: at,
    });
  }

  if (verified?.ok) {
    // A correct code proves the person, so the operator's wrong answers are forgotten.
    await store.clearCliMfaFailures(actor.id);
    return {
      mfa: recovery ? "recovery" : "totp",
      remaining: verified.remaining ?? null,
      skipped: false,
    };
  }

  // One row per wrong answer; the fifth closes the group at once. Counting again after the
  // insert makes a parallel command's row visible instead of reporting a stale count.
  await store.recordCliMfaFailure({ userId: actor.id, at });
  const count = await store.countCliMfaFailures({ userId: actor.id, since });
  if (count >= CLI_MFA_ATTEMPTS) throw cliMfaError(lockedMessage(), "MFA_LOCKED");
  throw cliMfaError(
    `that code did not work (${verified?.reason ?? "mismatch"}); ` +
      `${CLI_MFA_ATTEMPTS - count} ${CLI_MFA_ATTEMPTS - count === 1 ? "attempt" : "attempts"} left`,
  );
}
