import "server-only";
import { type FreeEntitlement } from "@cold-call-gym/shared";
import { callSessionStore } from "./server/store";
import { getEntitlement } from "./server/entitlement";
import { SCENARIOS } from "./scenarios";

export type RecentSession = {
  id: string;
  scenarioName: string;
  state: string;
  durationSeconds: number;
  createdAt: string;
};

export type RecommendedScenario = {
  slug: string;
  name: string;
  difficulty: string;
  objective: string;
};

export type DashboardData = FreeEntitlement & {
  callsThisWeek: number;
  recentSessions: RecentSession[];
  recommended: RecommendedScenario[];
};

function scenarioName(slug: string): string {
  return SCENARIOS.find((s) => s.slug === slug)?.name ?? "Practice call";
}

export async function getDashboardData(accessId: string): Promise<DashboardData> {
  // Authoritative daily allowance — same server-only computation used by
  // GET /api/entitlement and the call-authorization path. Never derive
  // this from a client-supplied value.
  const entitlement = await getEntitlement(accessId);

  const startOfWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const [callsThisWeek, recentRecords] = await Promise.all([
    callSessionStore.countSince(accessId, startOfWeek),
    callSessionStore.recentForAccess(accessId, 5),
  ]);

  const recentSessions: RecentSession[] = recentRecords.map((record) => ({
    id: record.id,
    scenarioName: scenarioName(record.scenarioSlug),
    state: record.state,
    durationSeconds: record.durationSeconds ?? 0,
    createdAt: record.createdAt,
  }));

  const recommended: RecommendedScenario[] = SCENARIOS.slice(0, 3).map((s) => ({
    slug: s.slug,
    name: s.name,
    difficulty: s.difficulty,
    objective: s.objective,
  }));

  return {
    ...entitlement,
    callsThisWeek,
    recentSessions,
    recommended,
  };
}
