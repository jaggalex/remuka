/**
 * The one reader of `REMO_STAGE` (ADR-261, `spec/stage.md` §5).
 *
 * A test stand repeats a cloud installation with test data, so it must announce itself
 * and refuse the actions that could reach a real person or real money. Every such rule
 * asks this module instead of reading the environment directly: one flag, one list of
 * consequences, and a production installation cannot switch a stand behaviour on by
 * setting half a pair.
 *
 * Nothing here touches the network or the database. The functions are pure, which is
 * what makes "without `REMO_STAGE=1` none of this happens" a unit test rather than a
 * promise (`stage.test.mjs`).
 */

/** The only value that marks a stand; `true`, `yes` and `stage` are typos, not flags. */
const STAGE_VALUE = "1";

export function isStage(env = process.env) {
  return String(env?.REMO_STAGE ?? "").trim() === STAGE_VALUE;
}

/** A command that exists only on a stand; the message says how to mark one. */
export function assertStage(env = process.env, what = "this command") {
  if (isStage(env)) return;
  throw new Error(
    `${what} is available only on a test stand: set REMO_STAGE=1 (ADR-261, spec/stage.md §6)`,
  );
}

/**
 * `REMO_LEGAL_ALLOW_DRAFTS=1` is a stand permission, never a production one.
 *
 * A draft is editable, so accepting it proves nothing. The service must stop at start-up
 * rather than on the first registration: an installation that answers traffic and then
 * fails is worse than one that never opened the port.
 */
export function legalDraftsWanted(env = process.env) {
  return String(env?.REMO_LEGAL_ALLOW_DRAFTS ?? "").trim() === "1";
}

export function legalDraftsAllowed(env = process.env) {
  return isStage(env) && legalDraftsWanted(env);
}

export function assertLegalDraftsFlag(env = process.env) {
  if (!legalDraftsWanted(env) || isStage(env)) return;
  throw new Error(
    "[legal] REMO_LEGAL_ALLOW_DRAFTS=1 is allowed only together with REMO_STAGE=1 " +
      "(a test stand): publish the required documents on production " +
      "(ADR-261, spec/stage.md §5)",
  );
}

/**
 * The mail allow-list of a stand: addresses (`person@example.com`) and domains
 * (`example.com` or `@example.com`), comma-separated. An empty list is empty, not
 * "everyone": callers decide whether an external driver may run without it.
 */
export function mailAllowRecipients(env = process.env) {
  if (!isStage(env)) return [];
  return String(env?.REMO_MAIL_ALLOW_RECIPIENTS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
}

/** True for an address or a domain in the list; an address wins over a domain. */
export function recipientAllowed(address, allow = []) {
  const value = String(address ?? "")
    .trim()
    .toLowerCase();
  const at = value.lastIndexOf("@");
  if (at <= 0 || at === value.length - 1) return false;
  const domain = value.slice(at + 1);
  return allow.some((entry) => entry === value || entry === domain);
}

/**
 * A mail driver that leaves the machine: Resend, or SMTP to anything other than the
 * stand's own Mailpit. `smtp://mail:1025` and a loopback address are the catcher; a
 * remote host is the real world and needs the allow-list.
 */
export function internalMailHost(host) {
  const value = String(host ?? "").trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!value) return false;
  if (["localhost", "mail", "mailpit", "host.docker.internal"].includes(value)) return true;
  if (value.endsWith(".local") || value.endsWith(".internal") || value.endsWith(".docker")) {
    return true;
  }
  if (value === "::1" || value.startsWith("127.")) return true;
  const parts = value.split(".").map(Number);
  if (parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
    return (
      parts[0] === 10 ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    );
  }
  return false;
}

export function smtpHost(smtpUrl) {
  try {
    return new URL(String(smtpUrl ?? "")).hostname;
  } catch {
    return "";
  }
}

/** The stand's own catcher, or `null` when the driver is not smtp. */
export function internalMailer(smtpUrl) {
  return internalMailHost(smtpHost(smtpUrl));
}

/**
 * A stage letter's subject: the stand's mark in the language of the letter, not of the
 * interface. One place, so a new template cannot forget it (`spec/stage.md` §5).
 */
export function stageSubject(subject, locale = "en") {
  const prefix = String(locale).toLowerCase().startsWith("ru") ? "[Стенд]" : "[Stage]";
  const text = String(subject ?? "");
  return text.startsWith(prefix) ? text : `${prefix} ${text}`;
}

/**
 * Live payment connections are a production act. On a stand the operator creates a
 * test-mode connection instead; a live route that already existed is refused per
 * payment, because deleting it would hide the misconfiguration.
 */
export function liveBillingAllowed(env = process.env) {
  return !isStage(env);
}

export function assertLiveBillingAllowed(mode, env = process.env) {
  if (!isStage(env) || mode !== "live") return;
  throw new Error(
    "live payment connections are refused on a test stand: create a --mode test connection " +
      "(REMO_STAGE=1, spec/stage.md §5)",
  );
}

/** A host that would index the production site must never index a stand. */
export const STAGE_ROBOTS = "noindex, nofollow";

/** The public `/config` and `/health` answer: `true` on a stand, absent elsewhere. */
export function stagePublicField(env = process.env) {
  return isStage(env) ? true : undefined;
}
