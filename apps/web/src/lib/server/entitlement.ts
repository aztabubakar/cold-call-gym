import "server-only";
import {
  DAILY_FREE_SECONDS,
  SECONDS_PER_CREDIT,
  MAX_CALL_SECONDS,
  type Entitlement,
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

export type CallAuthorizationCore = {
  sessionId: string;
  scenarioId: string;
  state: "authorized";
  maxAllowedSeconds: number;
  freeSecondsRemaining: number;
  paidCreditsRemaining: number;
};

export type AuthorizeCallResult =
  | { authorization: CallAuthorizationCore }
  | { error: "scenario_not_found" }
  | { error: "no_entitlement"; entitlement: Entitlement };

/**
 * Server-side foundation for authorizing a future voice call. Validates
 * entitlement and creates the `call_sessions` row in state `authorized`.
 * Does NOT itself connect to a voice provider or sign the gateway token —
 * signing happens in the API route (lib/server/voice-token.ts) so this
 * module stays focused on entitlement/DB concerns. The signed token is what
 * lets the browser open exactly one voice-gateway WebSocket connection for
 * this session; the gateway re-validates the session's live DB state before
 * starting anything.
 *
 * This is a soft gate: it reads the current entitlement and rejects when
 * usable time is zero, but doesn't debit anything, so a benign race between
 * two concurrent authorize calls isn't a financial risk. The HARD, atomic
 * gate is the finalize_call_usage() Postgres RPC
 * (supabase/migrations/003_entitlement_foundation.sql) — as of Phase 3 the
 * voice gateway (services/voice-gateway/src/lib/entitlement.ts) is the only
 * caller, using its own service-role credentials and its own
 * gateway-timed duration. The web app deliberately does NOT expose an HTTP
 * endpoint that lets the browser submit a duration for finalization; that
 * was a Phase 2 development convenience and has been removed now that the
 * gateway is authoritative.
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

