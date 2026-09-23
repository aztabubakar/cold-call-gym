import "server-only";
import {
  DAILY_FREE_SECONDS,
  MAX_CALL_SECONDS,
  computeMaxAllowedSeconds,
  type FreeEntitlement,
} from "@cold-call-gym/shared";
import { callSessionStore } from "./store";
import { getScenarioBySlug } from "../scenarios";

/**
 * Server-authoritative free-plan entitlement snapshot for one access
 * identity (a lead's opaque accessId — see lib/server/access.ts). Never
 * trust a browser-supplied value — this is always recomputed from the
 * call-session store.
 *
 * Cold Call Gym has no accounts, no paid credits, no subscriptions, and
 * no Stripe integration (see docs/MONETIZATION.md) — every access
 * identity gets a single free daily allowance. It resets on a UTC
 * calendar-day boundary. Rather than mutating/decrementing a stored
 * balance at midnight (which would need a cron job), we derive
 * usedTodaySeconds on every read as the sum of finalized usage whose
 * usageFinalizedAt falls within [start of today UTC, now) — so "today's
 * usage" simply stops counting sessions from a previous UTC day without
 * ever needing a reset job. See
 * apps/web/src/lib/server/store/memory-store.ts's finalizeUsage() for the
 * matching write-time implementation.
 */
export async function getEntitlement(accessId: string): Promise<FreeEntitlement> {
  const startOfDayUtc = new Date();
  startOfDayUtc.setUTCHours(0, 0, 0, 0);
  const resetsAt = new Date(startOfDayUtc.getTime() + 24 * 60 * 60 * 1000);

  const usedTodaySeconds = await callSessionStore.usedTodaySeconds(accessId);
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
 * entitlement and creates the call-session record in state `authorized`.
 * Does NOT itself connect to a voice provider or sign the gateway token —
 * signing happens in the API route (lib/server/voice-token.ts) so this
 * module stays focused on entitlement/storage concerns. The signed token
 * is what lets the browser open exactly one voice-gateway WebSocket
 * connection for this session; the gateway re-validates the session's
 * live state before starting anything.
 *
 * This is a soft gate: it reads the current entitlement and rejects when
 * there's no time left today, but doesn't write any usage, so a benign
 * race between two concurrent authorize calls isn't a correctness risk.
 * The HARD, atomic gate is CallSessionStore.finalizeUsage() — the voice
 * gateway (via the internal API, see
 * apps/web/src/app/api/internal/sessions/[id]/route.ts) is the only
 * caller. The web app deliberately does NOT expose an HTTP endpoint that
 * lets the browser submit a duration for finalization.
 */
export async function authorizeCallSession(
  accessId: string,
  scenarioSlug: string,
): Promise<AuthorizeCallResult> {
  const scenario = await getScenarioBySlug(scenarioSlug);
  if (!scenario) return { error: "scenario_not_found" };

  const entitlement = await getEntitlement(accessId);
  if (!entitlement.canStartCall) {
    return { error: "no_entitlement", entitlement };
  }

  const maxAllowedSeconds = computeMaxAllowedSeconds(entitlement.remainingTodaySeconds, MAX_CALL_SECONDS);

  const session = await callSessionStore.create({
    accessId,
    scenarioId: scenario.id,
    scenarioSlug: scenario.slug,
  });

  return {
    authorization: {
      sessionId: session.id,
      scenarioId: scenario.id,
      state: "authorized",
      maxAllowedSeconds,
      remainingTodaySeconds: entitlement.remainingTodaySeconds,
    },
  };
}
