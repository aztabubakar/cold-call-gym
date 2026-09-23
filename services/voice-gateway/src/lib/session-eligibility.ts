import type { VoiceSessionTokenClaims } from "@cold-call-gym/shared";
import type { CallSessionRow } from "./supabase.js";

export type EligibilityResult =
  | { ok: true }
  | { ok: false; code: "forbidden" | "conflict" };

/**
 * Re-validates a session against its live database row before the gateway
 * does anything billable. The signed token proves "the web server recently
 * authorized this call for this user" — it does NOT get to skip this
 * check. In particular this is what stops:
 *   - user A's token being used against user B's session (ownership),
 *   - a token minted for one scenario being reused against a session tied
 *     to a different scenario,
 *   - reconnecting to a session that has already completed, failed, or is
 *     mid-connection elsewhere (only `authorized` sessions may start).
 */
export function evaluateSessionEligibility(
  session: CallSessionRow,
  claims: VoiceSessionTokenClaims,
): EligibilityResult {
  if (session.user_id !== claims.sub || session.scenario_id !== claims.scenarioId) {
    return { ok: false, code: "forbidden" };
  }

  if (session.usage_finalized_at !== null || session.state !== "authorized") {
    return { ok: false, code: "conflict" };
  }

  return { ok: true };
}
