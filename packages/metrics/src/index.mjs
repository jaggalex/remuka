/**
 * Product metrics contract (ADR-082).
 *
 * One envelope and one event list for web and sync. The recorder never throws into the
 * product: a metrics sink is best-effort, and a missing/disabled sink is a no-op.
 */
export const METRIC_NAMES = Object.freeze([
  "session.started",
  "org.created",
  "board.created",
  "board.trashed",
  "board.restored",
  "board.duplicated",
  "board.saved",
  "object.created",
  "connector.created",
  "connector.waypoint_added",
  "share.invited",
  "role.changed",
  "link.enabled",
  "link.security",
  "export.requested",
  "export.completed",
  "agent.task.finished",
  "scenario.started",
  "scenario.completed",
  "onboarding.step",
  "activation.first_value",
  "help.opened",
  "help.search",
  "billing.subscription_started",
  "pulse.viewed",
  "chrome.used",
]);

export const ACTOR_TYPES = Object.freeze(["user", "agent", "visitor"]);

/**
 * The closed list of chrome controls `chrome.used` may name (ADR-266 §9, ADR-294).
 *
 * These are the ids of the command registry (`apps/web/src/commandsChrome.ts`) and the
 * header rows that dispatch one. The list lives here because the web sender, the sync
 * route and the Pulse aggregate must agree on one set: a menu row that is not here is
 * not measured, and a string that is not here is refused by `metricEvent`.
 *
 * `where` is where the control is offered today: `header` is one click away in the room
 * header, `menu` is behind a menu or the ⌘K search. The Pulse uses it for the "> 40 % of
 * a hidden control" rule; moving a row between the two is a recorded decision, not a
 * copy edit (ADR-266).
 */
export const CHROME_CONTROLS = Object.freeze([
  { id: "canvas.addCard", where: "menu" },
  { id: "canvas.addTable", where: "menu" },
  { id: "canvas.addKanban", where: "menu" },
  { id: "canvas.addComment", where: "menu" },
  { id: "room.rename", where: "menu" },
  { id: "room.settings", where: "menu" },
  { id: "room.properties", where: "menu" },
  { id: "room.access", where: "menu" },
  { id: "room.export", where: "menu" },
  { id: "room.restore", where: "menu" },
  { id: "room.duplicate", where: "menu" },
  { id: "room.copyLink", where: "menu" },
  { id: "room.template", where: "menu" },
  { id: "room.apps", where: "menu" },
  { id: "room.replace", where: "menu" },
  { id: "room.trash", where: "menu" },
  { id: "run.timer", where: "menu" },
  { id: "run.vote", where: "menu" },
  { id: "run.presentation", where: "menu" },
  { id: "run.follow", where: "menu" },
  { id: "agent.open", where: "menu" },
  { id: "agent.ask", where: "menu" },
  { id: "agent.settings", where: "menu" },
  { id: "invite.open", where: "header" },
  { id: "account.allRooms", where: "menu" },
  { id: "account.theme.light", where: "menu" },
  { id: "account.theme.dark", where: "menu" },
  { id: "account.motion.calm", where: "menu" },
  { id: "account.lang.ru", where: "menu" },
  { id: "account.lang.en", where: "menu" },
  { id: "account.help", where: "menu" },
  { id: "help.resetHints", where: "menu" },
  { id: "search.open", where: "menu" },
  { id: "account.sessions", where: "menu" },
  { id: "account.security", where: "menu" },
  { id: "account.org", where: "menu" },
  { id: "account.support", where: "menu" },
  { id: "account.cookies", where: "menu" },
  { id: "account.documents", where: "menu" },
  { id: "account.docs", where: "menu" },
  { id: "account.delete", where: "menu" },
  { id: "account.signOut", where: "menu" },
  { id: "account.signIn", where: "menu" },
  { id: "header.agent", where: "menu" },
  { id: "header.comments", where: "menu" },
]);

export const CHROME_CONTROL_IDS = Object.freeze(CHROME_CONTROLS.map((control) => control.id));

/**
 * The one place a new product fact is declared: name, required props and a short
 * purpose. A metric formula belongs in SQL/dashboards, not in this table; if a new KPI
 * needs a fact that is not emitted yet, add an event here once.
 */
export const METRIC_CATALOG = Object.freeze({
  "session.started": { required: [], optional: ["entry"], purpose: "A signed-in session began" },
  "org.created": { required: ["source"], optional: [], purpose: "A workspace (organisation) was created" },
  "board.created": { required: [], optional: ["teamId"], purpose: "A board was created" },
  "board.trashed": { required: [], optional: [], purpose: "A board was moved to the trash" },
  "board.restored": { required: [], optional: [], purpose: "A board was restored from the trash" },
  "board.duplicated": { required: ["sourceId"], optional: [], purpose: "A board was copied" },
  "board.saved": { required: ["objectCount"], optional: ["connectorCount"], purpose: "The client received a save acknowledgement" },
  "object.created": { required: ["objectType"], optional: [], purpose: "An object was added" },
  "connector.created": { required: ["routing"], optional: [], purpose: "A connector was created" },
  "connector.waypoint_added": { required: [], optional: [], purpose: "A rigid point was added" },
  "share.invited": { required: ["role"], optional: ["subjectType"], purpose: "A person was invited to a board" },
  "role.changed": { required: ["from", "to"], optional: [], purpose: "A board role changed" },
  "link.enabled": { required: ["state"], optional: [], purpose: "The public link changed state" },
  "link.security": { required: [], optional: ["password", "expires"], purpose: "Link password or expiry changed" },
  "export.requested": { required: ["scope", "format"], optional: ["objectCount"], purpose: "An export job was requested" },
  "export.completed": { required: ["scope", "format"], optional: ["bytes"], purpose: "An export result was delivered" },
  "agent.task.finished": { required: ["status", "skill"], optional: ["actions", "costUsd", "seconds"], purpose: "An agent task finished" },
  "scenario.started": { required: ["scenarioId"], optional: [], purpose: "A key user scenario began" },
  "scenario.completed": { required: ["scenarioId", "outcome"], optional: ["durationMs", "failureReason"], purpose: "A key user scenario finished" },
  "onboarding.step": { required: ["step"], optional: [], purpose: "A mandatory or optional onboarding step changed" },
  "activation.first_value": { required: ["kind"], optional: [], purpose: "The first useful result was reached" },
  "help.opened": { required: [], optional: ["topicId"], purpose: "A help topic was opened" },
  "help.search": { required: ["lang", "queryLength", "resultCount"], optional: [], purpose: "Help search ran; query text is never sent" },
  "billing.subscription_started": { required: ["plan"], optional: [], purpose: "Billing only; reserved until a billing source exists" },
  "pulse.viewed": { required: [], optional: [], purpose: "The operator opened the Pulse panel" },
  // One control from the closed registry list, first use per organisation per UTC day
  // (ADR-266 §9). No room, person or session id belongs here: the aggregate answers
  // "which element is used", not "who used it where".
  "chrome.used": { required: ["control"], optional: [], purpose: "A chrome command ran; first use per organisation per day" },
});

const CONTENT_KEYS = new Set(["text", "title", "content", "email", "name", "query", "boardName", "userName"]);

export function createRecorder({ sink = null, enabled = false } = {}) {
  return {
    get enabled() {
      return Boolean(enabled && sink);
    },
    emit(event) {
      if (!enabled || !sink) return;
      try {
        sink(event);
      } catch {
        // Metrics must never break a board or an agent task.
      }
    },
  };
}

/** Build a validated envelope. IDs are UUIDs; no names, emails or board content. */
export function metricEvent({
  name,
  orgId,
  actorId = null,
  actorType = "user",
  boardId = null,
  sessionId = null,
  appVersion = "dev",
  props = {},
}) {
  if (!METRIC_NAMES.includes(name)) throw new Error(`unknown metric: ${name}`);
  if (!ACTOR_TYPES.includes(actorType)) throw new Error(`unknown actor type: ${actorType}`);
  const definition = METRIC_CATALOG[name];
  if (!definition) throw new Error(`unknown metric: ${name}`);
  for (const key of definition.required) {
    if (!(key in (props ?? {}))) throw new Error(`metric ${name} needs prop ${key}`);
  }
  for (const [key, value] of Object.entries(props ?? {})) {
    if (CONTENT_KEYS.has(key)) throw new Error(`metric ${name}: prop ${key} may contain content or personal data`);
    if (value !== null && !["string", "number", "boolean"].includes(typeof value)) {
      throw new Error(`metric ${name}: prop ${key} must be a scalar`);
    }
  }
  // `chrome.used` is the one event whose only property is a control from a closed list.
  // An extra key could smuggle a room or a person into the stream, so it is refused.
  if (name === "chrome.used") {
    const extra = Object.keys(props ?? {}).filter((key) => key !== "control");
    if (extra.length) {
      throw new Error(`metric ${name}: only the control property is allowed`);
    }
    if (!CHROME_CONTROL_IDS.includes(props?.control)) {
      throw new Error(`metric ${name}: unknown control ${JSON.stringify(props?.control)}`);
    }
  }
  return {
    event_id: crypto.randomUUID(),
    name,
    occurred_at: new Date().toISOString(),
    org_id: orgId ?? null,
    actor_id: actorId ?? null,
    actor_type: actorType,
    board_id: boardId ?? null,
    session_id: sessionId ?? null,
    app_version: appVersion,
    schema_version: 1,
    props: props ?? {},
  };
}
