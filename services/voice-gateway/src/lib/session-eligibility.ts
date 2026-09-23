import type { VoiceSessionTokenClaims } from "@cold-call-gym/shared";
import type { CallSessionRecord } from "./session-store.js";

export type EligibilityResult =
  | { ok: true }
  | { ok: false; code: "forbidden" | "conflict" };

/**
 * Re-validates a session against its live state (fetched from the web
 * app's internal session API) before the gateway does anything billable.
 * The signed token proves "the web server recently authorized this call
 * for this access identity" — it does NOT get to skip this check. In
 * particular this is what stops:
 *   - one access identity's token being used against another's session
 *     (ownership),
 *   - a token minted for one scenario being reused against a session tied
 *     to a different scenario,
 *   - reconnecting to a session that has already completed, failed, or is
 *     mid-connection elsewhere (only `authorized` sessions may start).
 */
export function evaluateSessionEligibility(
  session: CallSessionRecord,
  claims: VoiceSessionTokenClaims,
): EligibilityResult {
  if (session.accessId !== claims.sub || session.scenarioId !== claims.scenarioId) {
    return { ok: false, code: "forbidden" };
  }

  if (session.usageFinalizedAt !== null || session.state !== "authorized") {
    return { ok: false, code: "conflict" };
  }

  return { ok: true };
}
