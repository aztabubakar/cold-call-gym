import "server-only";
import {
  DAILY_FREE_SECONDS,
  SECONDS_PER_CREDIT,
  MAX_CALL_SECONDS,
  type Entitlement,
  type CallAuthorization,
} from "@cold-call-gym/shared";
import { createServiceRoleClient } from "../supabase/service";

/**
 * Server-authoritative entitlement snapshot. Never trust a browser-supplied
 * balance — this is always recomputed from the database via the
 * service-role client (RLS-bypassing, server-only).
 *
 * Daily free allowance resets on a UTC calendar-day boundary. Rather than
 * mutating/decrementing a stored balance at midnight (which would need a
 * cron job), we derive freeSecondsUsedToday on every read as:
 *
 *   sum(call_sessions.free_seconds_used)
 *   where usage_finalized_at falls within [start of today UTC, now)
 *
 * so "today's free minutes" simply stops counting sessions from a previous
 * UTC day without ever needing a reset job. See
 * supabase/migrations/003_entitlement_foundation.sql for the matching
 * server-side (RPC) implementation used at charge time.
 */
export async function getEntitlement(userId: string): Promise<Entitlement> {
  const supabase = createServiceRoleClient();

  const startOfDayUtc = new Date();
  startOfDayUtc.setUTCHours(0, 0, 0, 0);

  const [freeUsedResult, ledgerResult] = await Promise.all([
    supabase
      .from("call_sessions")
      .select("free_seconds_used")
      .eq("user_id", userId)
      .not("usage_finalized_at", "is", null)
      .gte("usage_finalized_at", startOfDayUtc.toISOString()),
    supabase.from("credit_ledger").select("credits_delta").eq("user_id", userId),
  ]);

  if (freeUsedResult.error) throw freeUsedResult.error;
  if (ledgerResult.error) throw ledgerResult.error;

  const freeSecondsUsedToday = (freeUsedResult.data ?? []).reduce(
    (sum, row) => sum + (row.free_seconds_used ?? 0),
    0,
  );
  const freeSecondsRemaining = Math.max(0, DAILY_FREE_SECONDS - freeSecondsUsedToday);

  const paidCreditsRemaining = Math.max(
    0,
    (ledgerResult.data ?? []).reduce((sum, row) => sum + (row.credits_delta ?? 0), 0),
  );
  const paidSecondsAvailable = paidCreditsRemaining * SECONDS_PER_CREDIT;

  return {
    freeDailySeconds: DAILY_FREE_SECONDS,
    freeSecondsUsedToday,
    freeSecondsRemaining,
    paidCreditsRemaining,
    paidSecondsAvailable,
    totalUsableSeconds: freeSecondsRemaining + paidSecondsAvailable,
  };
}

export type AuthorizeCallResult =
  | { authorization: CallAuthorization }
  | { error: "scenario_not_found" }
  | { error: "no_entitlement"; entitlement: Entitlement };

/**
 * Server-side foundation for authorizing a future voice call (Phase 2). This
 * only validates entitlement and creates the `call_sessions` row — it does
 * NOT connect to a voice provider or issue a signed gateway token; that
 * arrives with the real voice-gateway integration in Phase 3.
 *
 * This is a soft gate: it reads the current entitlement and rejects when
 * usable time is zero, but doesn't debit anything, so a benign race between
 * two concurrent authorize calls isn't a financial risk. The HARD,
 * atomic gate is finalizeCallUsage() below, which is the only place credits
 * actually get spent.
 */
export async function authorizeCallSession(
  userId: string,
  scenarioSlug: string,
): Promise<AuthorizeCallResult> {
  const supabase = createServiceRoleClient();

  const { data: scenario, error: scenarioError } = await supabase
    .from("scenarios")
    .select("id")
    .eq("slug", scenarioSlug)
    .eq("is_active", true)
    .maybeSingle();

  if (scenarioError) throw scenarioError;
  if (!scenario) return { error: "scenario_not_found" };

  const entitlement = await getEntitlement(userId);
  if (entitlement.totalUsableSeconds <= 0) {
    return { error: "no_entitlement", entitlement };
  }

  const maxAllowedSeconds = Math.min(entitlement.totalUsableSeconds, MAX_CALL_SECONDS);

  const { data: session, error: insertError } = await supabase
    .from("call_sessions")
    .insert({ user_id: userId, scenario_id: scenario.id, state: "authorized" })
    .select("id")
    .single();

  if (insertError || !session) {
    throw insertError ?? new Error("failed to create call session");
  }

  return {
    authorization: {
      sessionId: session.id as string,
      scenarioId: scenario.id as string,
      state: "authorized",
      maxAllowedSeconds,
      freeSecondsRemaining: entitlement.freeSecondsRemaining,
      paidCreditsRemaining: entitlement.paidCreditsRemaining,
    },
  };
}

export type FinalizeUsageResult = {
  sessionId: string;
  state: string;
  durationSeconds: number;
  freeSecondsUsed: number;
  paidCreditsUsed: number;
  alreadyFinalized: boolean;
};

/**
 * The single authoritative, atomic, idempotent usage-debit path. Delegates
 * the actual balance math to the finalize_call_usage() Postgres function
 * (supabase/migrations/003_entitlement_foundation.sql), which:
 *   - locks the session row (`for update`) so duplicate finalize calls for
 *     the SAME session serialize and the loser gets the idempotent result
 *     instead of double-charging;
 *   - takes a per-user Postgres advisory lock so concurrent finalize calls
 *     across DIFFERENT sessions belonging to the same user can't both read
 *     a stale credit balance and overspend it;
 *   - clamps the claimed duration to wall-clock time elapsed since the
 *     session was created, as a backstop against an implausible
 *     client-reported value.
 *
 * `claimedDurationSeconds` is client-reported presentation state (the mock
 * call UI's own timer) and is NEVER trusted as-is — it is only an upper
 * bound the database may clamp further down. True server-metered duration
 * arrives with the Phase 3 voice-gateway integration.
 */
export async function finalizeCallUsage(params: {
  userId: string;
  sessionId: string;
  claimedDurationSeconds: number;
}): Promise<FinalizeUsageResult> {
  const supabase = createServiceRoleClient();

  const { data: session, error: sessionError } = await supabase
    .from("call_sessions")
    .select("id, user_id")
    .eq("id", params.sessionId)
    .maybeSingle();

  if (sessionError) throw sessionError;
  if (!session || session.user_id !== params.userId) {
    throw new Error("session_not_found_or_forbidden");
  }

  const idempotencyKey = `usage:${params.sessionId}`;
  const safeDuration = Math.max(0, Math.floor(params.claimedDurationSeconds));

  const { data, error } = await supabase.rpc("finalize_call_usage", {
    p_session_id: params.sessionId,
    p_claimed_duration_seconds: safeDuration,
    p_idempotency_key: idempotencyKey,
  });

  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("finalize_call_usage returned no result");

  return {
    sessionId: row.session_id,
    state: row.state,
    durationSeconds: row.duration_seconds,
    freeSecondsUsed: row.free_seconds_used,
    paidCreditsUsed: row.paid_credits_used,
    alreadyFinalized: row.already_finalized,
  };
}
