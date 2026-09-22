import { DAILY_FREE_SECONDS, type Entitlement } from "@cold-call-gym/shared";
import { createClient } from "./supabase/server";
import { getEntitlement } from "./server/entitlement";

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

export type DashboardData = Entitlement & {
  callsThisWeek: number;
  recentSessions: RecentSession[];
  recommended: RecommendedScenario[];
  supabaseConfigured: boolean;
};

const EMPTY_ENTITLEMENT: Entitlement = {
  freeDailySeconds: DAILY_FREE_SECONDS,
  freeSecondsUsedToday: 0,
  freeSecondsRemaining: DAILY_FREE_SECONDS,
  paidCreditsRemaining: 0,
  paidSecondsAvailable: 0,
  totalUsableSeconds: DAILY_FREE_SECONDS,
};

const EMPTY_DASHBOARD: DashboardData = {
  ...EMPTY_ENTITLEMENT,
  callsThisWeek: 0,
  recentSessions: [],
  recommended: [],
  supabaseConfigured: false,
};

export async function getDashboardData(userId: string): Promise<DashboardData> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return EMPTY_DASHBOARD;
  }

  try {
    // Authoritative free/paid balance — same server-only computation used by
    // GET /api/entitlement and the call-authorization path. Never derive
    // this from a client-supplied value.
    const entitlement = await getEntitlement(userId);

    const supabase = await createClient();
    const startOfWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [weekSessions, recentSessions, scenarios] = await Promise.all([
      supabase
        .from("call_sessions")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .gte("created_at", startOfWeek.toISOString()),
      supabase
        .from("call_sessions")
        .select("id, state, duration_seconds, created_at, scenarios(name)")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(5),
      supabase
        .from("scenarios")
        .select("slug, name, difficulty, objective")
        .eq("is_active", true)
        .limit(3),
    ]);

    const recent: RecentSession[] = (recentSessions.data ?? []).map((row) => {
      const scenario = Array.isArray(row.scenarios) ? row.scenarios[0] : row.scenarios;
      return {
        id: row.id as string,
        scenarioName: (scenario as { name?: string } | null)?.name ?? "Practice call",
        state: row.state as string,
        durationSeconds: (row.duration_seconds as number) ?? 0,
        createdAt: row.created_at as string,
      };
    });

    return {
      ...entitlement,
      callsThisWeek: weekSessions.count ?? 0,
      recentSessions: recent,
      recommended: scenarios.data ?? [],
      supabaseConfigured: true,
    };
  } catch {
    // Tables/RPCs may not exist yet (migration not applied) or the project
    // may be unreachable in this environment — degrade to a safe empty
    // state rather than crashing the dashboard.
    return { ...EMPTY_DASHBOARD, supabaseConfigured: true };
  }
}
