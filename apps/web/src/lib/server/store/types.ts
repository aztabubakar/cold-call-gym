import "server-only";

/**
 * Domain types and storage interfaces for Cold Call Gym's no-account,
 * lead-gated model. UI code and API routes depend only on these
 * interfaces (never on a concrete datastore), so the backing
 * implementation can be swapped later without touching call sites — see
 * memory-store.ts for the current (non-durable, single-process)
 * implementation and its documented limitations.
 */

export type Lead = {
  /** Opaque, server-generated identifier. Doubles as the access-session
   *  cookie value and as the `sub` claim in the voice-gateway JWT — never
   *  the lead's email or phone. */
  id: string;
  name: string;
  /** Normalized: trimmed + lowercased. */
  email: string;
  /** Normalized: trimmed, formatting characters stripped, leading '+'
   *  preserved when present. */
  phone: string;
  consent: boolean;
  createdAt: string;
};

export type CallSessionState =
  | "authorized"
  | "connecting"
  | "active"
  | "ending"
  | "completed"
  | "failed";

export type CallSessionRecord = {
  id: string;
  accessId: string;
  scenarioId: string;
  scenarioSlug: string;
  state: CallSessionState;
  createdAt: string;
  usageFinalizedAt: string | null;
  durationSeconds: number | null;
};

export type FinalizeUsageResult = {
  sessionId: string;
  state: string;
  durationSeconds: number;
  alreadyFinalized: boolean;
};

export type SalesInquiry = {
  id: string;
  leadId: string | null;
  name: string;
  workEmail: string;
  company: string;
  jobTitle: string | null;
  teamSize: string | null;
  phone: string | null;
  expectedUsage: string | null;
  message: string | null;
  createdAt: string;
};

export interface LeadStore {
  create(input: { name: string; email: string; phone: string; consent: boolean }): Promise<Lead>;
  get(id: string): Promise<Lead | null>;
}

export interface CallSessionStore {
  create(input: { accessId: string; scenarioId: string; scenarioSlug: string }): Promise<CallSessionRecord>;
  get(id: string): Promise<CallSessionRecord | null>;
  transitionState(id: string, state: CallSessionState): Promise<void>;
  markFailed(id: string): Promise<void>;
  /**
   * Atomically records a session's final duration, exactly once. Calls are
   * free and unlimited (see docs/MONETIZATION.md), so this just clamps the
   * claimed duration to wall-clock time elapsed since creation (defense in
   * depth against a bad claim) and stores it. A repeated call with the
   * same sessionId is a no-op that returns the original result with
   * alreadyFinalized: true.
   */
  finalizeUsage(params: {
    sessionId: string;
    durationSeconds: number;
    idempotencyKey: string;
  }): Promise<FinalizeUsageResult>;
  /** Seconds practiced today (UTC), for informational display only. */
  usedTodaySeconds(accessId: string): Promise<number>;
  /** Most recent sessions for this access identity, newest first. */
  recentForAccess(accessId: string, limit: number): Promise<CallSessionRecord[]>;
  /** Count of sessions created in the last N days for this access identity. */
  countSince(accessId: string, sinceIso: string): Promise<number>;
}

export interface SalesInquiryStore {
  create(input: Omit<SalesInquiry, "id" | "createdAt">): Promise<SalesInquiry>;
}
