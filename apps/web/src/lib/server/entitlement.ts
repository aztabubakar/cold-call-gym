import "server-only";
import { type PracticeStats } from "@cold-call-gym/shared";
import { callSessionStore } from "./store";
import { getScenarioBySlug } from "../scenarios";

/**
 * Practice-time stats for one access identity (a lead's opaque accessId —
 * see lib/server/access.ts). Cold Call Gym has no accounts, no paid
 * credits, no subscriptions, and no Stripe integration (see
 * docs/MONETIZATION.md) — voice practice is free and unlimited. This is
 * purely informational (e.g. "you've practiced 12m today" on the
 * dashboard), never a gate: nothing here decides whether a call may start.
 * See apps/web/src/lib/server/store/memory-store.ts's usedTodaySeconds()
 * for the matching write-time implementation.
 */
export async function getPracticeStats(accessId: string): Promise<PracticeStats> {
  const usedTodaySeconds = await callSessionStore.usedTodaySeconds(accessId);
  return { usedTodaySeconds };
}

export type CallAuthorizationCore = {
  sessionId: string;
  scenarioId: string;
  state: "authorized";
};

export type AuthorizeCallResult = { authorization: CallAuthorizationCore } | { error: "scenario_not_found" };

/**
 * Server-side foundation for authorizing a future voice call. Creates the
 * call-session record in state `authorized`. Does NOT itself connect to a
 * voice provider or sign the gateway token — signing happens in the API
 * route (lib/server/voice-token.ts) so this module stays focused on
 * storage concerns. The signed token is what lets the browser open exactly
 * one voice-gateway WebSocket connection for this session; the gateway
 * re-validates the session's live state before starting anything.
 *
 * Calls are free and unlimited, so the only way this can fail is an
 * unknown scenario.
 */
export async function authorizeCallSession(
  accessId: string,
  scenarioSlug: string,
): Promise<AuthorizeCallResult> {
  const scenario = await getScenarioBySlug(scenarioSlug);
  if (!scenario) return { error: "scenario_not_found" };

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
    },
  };
}
