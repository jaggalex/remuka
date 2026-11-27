/**
 * The operator console's API, as the browser sees it (`spec/operator.md` §5, stage 2).
 *
 * The console reads `/api/operator/...`; a non-operator gets `404` from every one of
 * these calls, and the screen shows the same nothing instead of guessing why.
 */
import { call } from "../apiCall";

export interface OperatorSession {
  operator: { id: string; email: string; name: string | null };
  confirmedAt: string | null;
  mfaAt: string | null;
  enrolled: boolean;
  recoveryLeft: number;
  stepUpMs: number;
  readHours: number;
  readMs: number;
  zone: string;
}

/** The `403 MFA_REQUIRED` answer: the console's own prompt (`spec/totp.md` §6). */
export interface OperatorMfaRequired {
  error: "MFA_REQUIRED";
  mfaRequired: true;
  enrollmentRequired?: boolean;
  operator: { id: string; email: string; name: string | null };
  challenge?: string;
  expiresAt?: string;
}

export interface PulseTile {
  id: string;
  value: number | null;
  previous: number | null;
  series: number[] | null;
  reason: string | null;
  basis: "derived" | "snapshot" | "rebuilt" | null;
}

export interface PulseZone {
  id: string;
  kind: "local" | "peer";
  fresh: boolean;
  origin?: string;
  lastSuccessAt: string | null;
  lastDay: string | null;
  reason: string | null;
}

export interface Pulse {
  generatedAt: string;
  weeks: number;
  from: string;
  to: string;
  zone: string;
  zoneFilter: string;
  zones: PulseZone[];
  zoneReason: string | null;
  lastCompleteDay: string | null;
  lastCompleteWeek: string | null;
  computedAt: string | null;
  currencies: string[];
  currency: string | null;
  breakeven: number;
  tiles: PulseTile[];
  growth: {
    registrations: number | null;
    activations: number | null;
    invitations: number | null;
    collaborating: number | null;
    paying: number | null;
    source: null;
    sources: Array<{ source: string; value: number }>;
    sourceReason: string | null;
  };
  engagement: {
    dau: number | null;
    wau: number | null;
    mau: number | null;
    stickiness: number | null;
    collaboration: number | null;
    reason: string | null;
  };
  chrome: {
    /** The last complete day, the end of the trailing 28-day window. */
    day: string | null;
    /** Organisations with a value event in those 28 days (the denominator). */
    activeOrgs: number | null;
    items: Array<{
      control: string;
      where: "header" | "menu";
      orgs: number | null;
      share: number | null;
      verdict: "deep" | "place" | null;
    }>;
    reason: string | null;
  };
  money: {
    mrrByCurrency: Array<{ currency: string; amount: number }>;
    byPlan: Array<{ plan: string; amount: number }>;
    mrrDay: string | null;
    freeToPaid: null;
    reason: string | null;
  };
  health: {
    mailDead: number | null;
    storeWriteErrors: number | null;
    storeWrites: number | null;
    aiUnavailable: number | null;
    wsRejected: number | null;
    reason: string | null;
  };
}

export interface CustomerMatch {
  kind: "user" | "org" | "invoice";
  id: string;
  label: string;
  detail: string | null;
  slug: string | null;
}

export interface CustomerCounts {
  members: number;
  guests: number;
  rooms: number;
}

export interface CustomerOrg {
  id: string;
  name: string | null;
  slug: string;
  kind: string;
  createdAt: string;
  suspendedAt?: string | null;
  suspensionRef?: string | null;
  relation?: string;
  membershipState?: string;
  roles?: string[];
  admins?: Array<{ id: string; email: string; name: string | null; lang: string | null }>;
  counts: CustomerCounts;
  billing: { email: string; name: string | null; currency: string | null; testMode: boolean } | null;
  subscription: {
    plan: string;
    status: string;
    amount: number;
    currency: string;
    interval: string;
    current_period_start: string;
    current_period_end: string;
    cancel_at_period_end?: boolean;
    trial_end?: string | null;
  } | null;
  invoices: Array<{
    id: string;
    number: string;
    status: string;
    total: number;
    currency: string;
    created_at: string;
    paid_at: string | null;
  }>;
  payments: Array<{
    id: string;
    created_at: string;
    status: string;
    amount: number;
    currency: string;
    invoice_number: string;
    /** What has already gone back on this payment (`spec/operator-actions.md` §1.1). */
    refunded: number;
  }>;
  credit: Array<{ currency: string; balance: number }>;
  acceptances: Array<{
    zone: string;
    doc: string;
    version: number;
    event: string;
    user_email: string | null;
    accepted_at: string;
  }>;
  actions: Array<{
    id: string;
    kind: string;
    subjectType: string;
    reasonInternal: string;
    reasonPublic: string;
    reportRef: string | null;
    createdAt: string;
    revertedAt: string | null;
  }>;
}

export interface CustomerCard {
  user: {
    id: string;
    email: string;
    name: string | null;
    handle: string;
    state: string;
    lang: string | null;
    createdAt: string;
    emailVerifiedAt: string | null;
  } | null;
  orgs: CustomerOrg[];
  supportUrl: string | null;
  zone: string;
}

export interface JournalEvent {
  id: string;
  at: string;
  actorId: string | null;
  actorEmail: string | null;
  actorName: string | null;
  orgId: string | null;
  orgName: string | null;
  action: string;
  subject: string | null;
  reason: string | null;
  after: unknown;
  /** Which surface acted and what proved the person (`spec/operator-actions.md` §3.1). */
  channel: "cli" | "console" | null;
  mfa: "totp" | "recovery" | null;
}

export interface OperatorMeasure {
  id: string;
  kind: string;
  subjectType: string;
  subjectId: string;
  reasonInternal: string;
  reasonPublic: string;
  reportRef: string | null;
  createdBy: string | null;
  createdByEmail?: string | null;
  createdAt: string;
  revertedAt: string | null;
  boardTitle?: string | null;
  orgName?: string | null;
}

export interface MoneyOverview {
  connections: Array<{
    id: string;
    provider: string;
    name: string;
    mode: "test" | "live";
    status: string;
    lastEventAt: string | null;
    lastHealthAt: string | null;
    lastHealthError: string | null;
  }>;
  deadEvents: Array<{
    id: string;
    orgId: string | null;
    orgName: string | null;
    provider: string;
    connectionName: string;
    type: string;
    error: string | null;
    attempts: number;
    deadAt: string;
  }>;
  refunds: Array<{
    id: string;
    orgId: string;
    orgName: string | null;
    orgSlug: string | null;
    amount: number;
    currency: string;
    status: string;
    createdAt: string;
    authorId: string | null;
    authorEmail: string | null;
    channel: "cli" | "console" | null;
  }>;
  movements: Array<{
    kind: "credit" | "manual";
    id: string;
    orgId: string;
    orgName: string | null;
    orgSlug: string | null;
    amount: number;
    currency: string;
    reason: string | null;
    createdAt: string;
    authorId: string | null;
    authorEmail: string | null;
  }>;
}

export interface RefundResult {
  already: boolean;
  paymentId: string;
  orgId?: string;
  invoiceNumber?: string;
  refundId: string;
  amount: number;
  currency: string;
  status: string;
  full: boolean;
  mailed: boolean;
  recipient?: string;
}

export const operatorApi = {
  session: () => call<OperatorSession>("/operator/session"),
  /**
   * The step-up answer: a TOTP code or one recovery code, never a password. The same
   * mechanism as the second sign-in step, with the session as its outcome (§6).
   */
  confirm: (body: { challenge: string; code?: string; recoveryCode?: string }) =>
    call<{ confirmedAt: string; mfaAt: string }>("/operator/session/confirm", {
      method: "POST",
      body,
    }),
  pulse: (params: { weeks: number; currency?: string | null; zone?: string | null }) => {
    const search = new URLSearchParams({ weeks: String(params.weeks) });
    if (params.currency) search.set("currency", params.currency);
    if (params.zone) search.set("zone", params.zone);
    return call<Pulse>(`/operator/pulse?${search.toString()}`);
  },
  customers: (q: string) =>
    call<{ query: string; matches: CustomerMatch[]; supportUrl: string | null }>(
      `/operator/customers?q=${encodeURIComponent(q)}`,
    ),
  customer: (kind: "user" | "org", id: string) =>
    call<CustomerCard>(`/operator/customers/${kind}/${encodeURIComponent(id)}`),
  journal: (filters: { action?: string; actor?: string; org?: string; from?: string; to?: string; limit?: number }) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== null && String(value).trim() !== "") {
        search.set(key, String(value));
      }
    }
    return call<{ events: JournalEvent[] }>(`/operator/journal?${search.toString()}`);
  },
  money: () => call<MoneyOverview>("/operator/money"),
  measures: () => call<{ actions: OperatorMeasure[] }>("/operator/measures"),
  refund: (
    paymentId: string,
    body: { amount?: number; expectRefunded: number; reason: string; requestId: string },
  ) =>
    call<{ ok: true; result: RefundResult }>(
      `/operator/payments/${encodeURIComponent(paymentId)}/refund`,
      { method: "POST", body },
    ),
  markPaid: (
    invoiceId: string,
    body: { reason: string; requestId: string; ref?: string },
  ) =>
    call<{ ok: true; result: { alreadyPaid: boolean; invoice: { id: string; number: string; status: string }; plan: string | null } }>(
      `/operator/invoices/${encodeURIComponent(invoiceId)}/mark-paid`,
      { method: "POST", body },
    ),
  credit: (
    orgId: string,
    body: { amount: number; currency?: string; reason: string; requestId: string },
  ) =>
    call<{ ok: true; result: { ledgerId: string; orgId: string; amount: number; currency: string } }>(
      `/operator/orgs/${encodeURIComponent(orgId)}/credit`,
      { method: "POST", body },
    ),
  grant: (
    orgId: string,
    body: { plan: string; until: string; currency?: string; reason: string; requestId: string },
  ) =>
    call<{ ok: true; result: { plan: string; until: string; priceId: string; amount: number; currency: string; interval: string } }>(
      `/operator/orgs/${encodeURIComponent(orgId)}/grant`,
      { method: "POST", body },
    ),
  measure: (
    body: { kind: string; target: string; reason: string; requestId: string; reportRef?: string },
  ) =>
    call<{ ok: true; result: { action: OperatorMeasure; created: boolean } }>("/operator/measures", {
      method: "POST",
      body,
    }),
  revertMeasure: (id: string, body: { reason: string; requestId: string }) =>
    call<{ ok: true; result: { action: OperatorMeasure; changed: boolean; mailed: boolean } }>(
      `/operator/measures/${encodeURIComponent(id)}/revert`,
      { method: "POST", body },
    ),
};
