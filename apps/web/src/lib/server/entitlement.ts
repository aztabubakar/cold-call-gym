import "server-only";
import {
  DAILY_FREE_SECONDS,
  MAX_CALL_SECONDS,
  computeMaxAllowedSeconds,
  type FreeEntitlement,
} from "@cold-call-gym/shared";
import { createServiceRoleClient } from "../supabase/service";

/**
 * Server-authoritative free-plan entitlement snapshot. Never trust a
 * browser-supplied value — this is always recomputed from the database via
 * the service-role client (RLS-bypassing, server-only).
 *
 * Cold Call Gym has no paid credits, no subscriptions, and no Stripe
 * integration (see docs/MONETIZATION.md) — every user gets a single free
 * daily allowance. Daily free allowance resets on a UTC calendar-day
 * boundary. Rather than mutating/decrementing a stored balance at midnight
 * (which would need a cron job), we derive usedTodaySeconds on every read
 * as:
 *
 *   sum(call_sessions.free_seconds_used)
 *   where usage_finalized_at falls within [start of today UTC, now)
 *
 * so "today's usage" simply stops counting sessions from a previous UTC day
 * without ever needing a reset job. See
 * supabase/migrations/004_free_plan_entitlement.sql for the matching
 * server-side (RPC) implementation used at charge time.
 */
export async function getEntitlement(userId: string): Promise<FreeEntitlement> {
  const supabase = createServiceRoleClient();

  const startOfDayUtc = new Date();
  startOfDayUtc.setUTCHours(0, 0, 0, 0);
  const resetsAt = new Date(startOfDayUtc.getTime() + 24 * 60 * 60 * 1000);

  const { data, error } = await supabase
    .from("call_sessions")
    .select("free_seconds_used")
    .eq("user_id", userId)
    .not("usage_finalized_at", "is", null)
    .gte("usage_finalized_at", startOfDayUtc.toISOString());

  if (error) throw error;

  const usedTodaySeconds = (data ?? []).reduce((sum, row) => sum + (row.free_seconds_used ?? 0), 0);
  const remainingTodaySeconds = Math.max(0, DAILY_FREE_SECONDS - usedTodaySeconds);

  return {
    plan: "free",
    dailyLimitSeconds: DAILY_FREE_SECONDS,
    usedTodaySeconds,
    remainingTodaySeconds,
    canStartCall: remainingTodaySeconds > 0,
    resetsAt: resetsAt.toISOString(),
  };
}

export type CallAuthorizationCore = {
  sessionId: string;
  scenarioId: string;
  state: "authorized";
  maxAllowedSeconds: number;
  remainingTodaySeconds: number;
};

export type AuthorizeCallResult =
  | { authorization: CallAuthorizationCore }
  | { error: "scenario_not_found" }
  | { error: "no_entitlement"; entitlement: FreeEntitlement };

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
 * there's no time left today, but doesn't write any usage, so a benign race
 * between two concurrent authorize calls isn't a correctness risk. The
 * HARD, atomic gate is the finalize_call_usage() Postgres RPC
 * (supabase/migrations/004_free_plan_entitlement.sql) — the voice gateway
 * (services/voice-gateway/src/lib/entitlement.ts) is the only caller, using
 * its own service-role credentials and its own gateway-timed duration. The
 * web app deliberately does NOT expose an HTTP endpoint that lets the
 * browser submit a duration for finalization.
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
  if (!entitlement.canStartCall) {
    return { error: "no_entitlement", entitlement };
  }

  const maxAllowedSeconds = computeMaxAllowedSeconds(entitlement.remainingTodaySeconds, MAX_CALL_SECONDS);

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
      remainingTodaySeconds: entitlement.remainingTodaySeconds,
    },
  };
}
