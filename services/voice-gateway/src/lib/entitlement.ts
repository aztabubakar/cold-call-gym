import { getSupabaseClient } from "./supabase.js";

export type FinalizeUsageResult = {
  sessionId: string;
  state: string;
  durationSeconds: number;
  freeSecondsUsed: number;
  paidCreditsUsed: number;
  alreadyFinalized: boolean;
};

/**
 * Gateway-side call into the SAME finalize_call_usage() Postgres RPC used
 * by the web app (see supabase/migrations/003_entitlement_foundation.sql
 * and apps/web/src/lib/server/entitlement.ts's history). This is Phase 3's
 * trust boundary: the gateway is the only thing that decides
 * `durationSeconds` (from its own monotonic timer — see
 * src/session-runtime.ts), and it calls this RPC directly with its own
 * SUPABASE_SERVICE_ROLE_KEY, never by asking the browser to submit a
 * duration over HTTP. The RPC itself remains atomic (per-session row lock +
 * per-user advisory lock) and idempotent (idempotency_key unique
 * constraint), exactly as verified in the Phase 2 integration tests — this
 * wrapper doesn't change that behavior, it's just a second authorized
 * caller.
 */
export async function finalizeCallUsage(params: {
  sessionId: string;
  durationSeconds: number;
  idempotencyKey: string;
}): Promise<FinalizeUsageResult> {
  const supabase = getSupabaseClient();
  const safeDuration = Math.max(0, Math.floor(params.durationSeconds));

  const { data, error } = await supabase.rpc("finalize_call_usage", {
    p_session_id: params.sessionId,
    p_claimed_duration_seconds: safeDuration,
    p_idempotency_key: params.idempotencyKey,
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
