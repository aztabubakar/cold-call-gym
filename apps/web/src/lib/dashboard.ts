import { DAILY_FREE_SECONDS } from "@cold-call-gym/shared";
import { usableSeconds } from "./entitlement";
import { createClient } from "./supabase/server";

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

export type DashboardData = {
  freeSecondsRemaining: number;
  paidCreditsRemaining: number;
  usableSeconds: number;
  callsThisWeek: number;
  recentSessions: RecentSession[];
  recommended: RecommendedScenario[];
  supabaseConfigured: boolean;
};

const EMPTY_DASHBOARD: DashboardData = {
  freeSecondsRemaining: DAILY_FREE_SECONDS,
  paidCreditsRemaining: 0,
  usableSeconds: DAILY_FREE_SECONDS,
  callsThisWeek: 0,
  recentSessions: [],
  recommended: [],
  supabaseConfigured: false,
};

export type EntitlementSnapshot = {
  freeSecondsRemaining: number;
  paidCreditsRemaining: number;
};

export async function getEntitlementSnapshot(userId: string): Promise<EntitlementSnapshot> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return { freeSecondsRemaining: DAILY_FREE_SECONDS, paidCreditsRemaining: 0 };
  }

  try {
    const supabase = await createClient();
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);

    const [todaySessions, ledger] = await Promise.all([
      supabase
        .from("call_sessions")
        .select("free_seconds_used")
        .eq("user_id", userId)
        .gte("created_at", startOfDay.toISOString()),
      supabase.from("credit_ledger").select("credits_delta").eq("user_id", userId),
    ]);

    const usedToday = (todaySessions.data ?? []).reduce(
      (sum, row) => sum + (row.free_seconds_used ?? 0),
      0,
    );

    return {
      freeSecondsRemaining: Math.max(0, DAILY_FREE_SECONDS - usedToday),
      paidCreditsRemaining: Math.max(
        0,
        (ledger.data ?? []).reduce((sum, row) => sum + (row.credits_delta ?? 0), 0),
      ),
    };
  } catch {
    return { freeSecondsRemaining: DAILY_FREE_SECONDS, paidCreditsRemaining: 0 };
  }
}

export async function getDashboardData(userId: string): Promise<DashboardData> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return EMPTY_DASHBOARD;
  }

  try {
    const supabase = await createClient();

    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const startOfWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [todaySessions, weekSessions, recentSessions, ledger, scenarios] = await Promise.all([
      supabase
        .from("call_sessions")
        .select("free_seconds_used")
        .eq("user_id", userId)
        .gte("created_at", startOfDay.toISOString()),
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
      supabase.from("credit_ledger").select("credits_delta").eq("user_id", userId),
      supabase
        .from("scenarios")
        .select("slug, name, difficulty, objective")
        .eq("is_active", true)
        .limit(3),
    ]);

    const usedToday = (todaySessions.data ?? []).reduce(
      (sum, row) => sum + (row.free_seconds_used ?? 0),
      0,
    );
    const freeSecondsRemaining = Math.max(0, DAILY_FREE_SECONDS - usedToday);

    const paidCreditsRemaining = Math.max(
      0,
      (ledger.data ?? []).reduce((sum, row) => sum + (row.credits_delta ?? 0), 0),
    );

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
      freeSecondsRemaining,
      paidCreditsRemaining,
      usableSeconds: usableSeconds({ freeSecondsRemaining, paidCreditsRemaining }),
      callsThisWeek: weekSessions.count ?? 0,
      recentSessions: recent,
      recommended: scenarios.data ?? [],
      supabaseConfigured: true,
    };
  } catch {
    // Tables may not exist yet (migration not applied) or the project may be
    // unreachable in this environment — degrade to a safe empty state rather
    // than crashing the dashboard.
    return { ...EMPTY_DASHBOARD, supabaseConfigured: true };
  }
}
