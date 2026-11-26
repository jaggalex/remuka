export type MetricName =
  | "session.started"
  | "org.created"
  | "board.created"
  | "board.trashed"
  | "board.restored"
  | "board.duplicated"
  | "board.saved"
  | "object.created"
  | "connector.created"
  | "connector.waypoint_added"
  | "share.invited"
  | "role.changed"
  | "link.enabled"
  | "link.security"
  | "export.requested"
  | "export.completed"
  | "agent.task.finished"
  | "scenario.started"
  | "scenario.completed"
  | "onboarding.step"
  | "activation.first_value"
  | "help.opened"
  | "help.search"
  | "billing.subscription_started"
  | "chrome.used"
  | "news.clicked"
  | "hint.shown"
  | "hint.acted";

export const NEWS_TYPES: readonly ["mention", "agent", "live", "joined"];

export type ActorType = "user" | "agent" | "visitor";

/** Where a chrome control is offered today (ADR-266 §9). */
export interface ChromeControl {
  /** The command registry id the event carries. */
  id: string;
  where: "header" | "menu";
}

/**
 * The closed list of controls `chrome.used` may name. The web sender, the sync route
 * and the Pulse aggregate read this one list.
 */
export declare const CHROME_CONTROLS: readonly ChromeControl[];
export declare const CHROME_CONTROL_IDS: readonly string[];

export interface MetricEvent {
  event_id: string;
  name: MetricName;
  occurred_at: string;
  org_id: string | null;
  actor_id: string | null;
  actor_type: ActorType;
  board_id: string | null;
  session_id: string | null;
  app_version: string;
  schema_version: 1;
  /** Only typed scalar properties; never board content or personal data. */
  props: Record<string, string | number | boolean | null>;
}

export declare const METRIC_NAMES: readonly MetricName[];
export declare const ACTOR_TYPES: readonly ActorType[];

export interface MetricDefinition {
  required: readonly string[];
  optional: readonly string[];
  purpose: string;
}
export declare const METRIC_CATALOG: Readonly<Record<MetricName, MetricDefinition>>;

export declare function createRecorder(options?: {
  sink?: ((event: MetricEvent) => void) | null;
  enabled?: boolean;
}): {
  readonly enabled: boolean;
  emit(event: MetricEvent): void;
};

export declare function metricEvent(input: {
  name: MetricName;
  orgId?: string | null;
  actorId?: string | null;
  actorType?: ActorType;
  boardId?: string | null;
  sessionId?: string | null;
  appVersion?: string;
  props?: MetricEvent["props"];
}): MetricEvent;
