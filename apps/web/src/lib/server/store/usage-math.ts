import { DAILY_FREE_SECONDS } from "@cold-call-gym/shared";

/**
 * Pure entitlement/finalization math, extracted out of memory-store.ts so
 * it can be unit-tested directly (memory-store.ts carries `import
 * "server-only"`, which throws under plain Vitest — the same reason
 * lib/contact-sales-schema.ts is split from lib/server/contact-sales.ts).
 * This reimplements the same algorithm as the retired Postgres RPC — see
 * legacy/supabase/migrations/004_free_plan_entitlement.sql.
 */

export function startOfUtcDayIso(nowMs: number = Date.now()): string {
  const d = new Date(nowMs);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

export function sumUsedToday(
  records: { usageFinalizedAt: string | null; freeSecondsUsed: number | null }[],
  nowMs: number = Date.now(),
): number {
  const todayStart = startOfUtcDayIso(nowMs);
  let total = 0;
  for (const r of records) {
    if (r.usageFinalizedAt !== null && r.usageFinalizedAt >= todayStart) {
      total += r.freeSecondsUsed ?? 0;
    }
  }
  return total;
}

export function computeRemainingSeconds(usedTodaySeconds: number): number {
  return Math.max(0, DAILY_FREE_SECONDS - usedTodaySeconds);
}

export type FinalizeComputation =
  | { alreadyFinalized: true; durationSeconds: number; freeSecondsUsed: number }
  | { alreadyFinalized: false; durationSeconds: number; freeSecondsUsed: number; usageFinalizedAt: string };

/**
 * Computes the result of finalizing one session's usage, given the
 * already-finalized usage of the SAME access identity's OTHER sessions
 * today. Never mutates anything — the caller (memory-store.ts) is
 * responsible for applying the result.
 */
export function computeFinalize(params: {
  session: {
    createdAt: string;
    usageFinalizedAt: string | null;
    state: string;
    existingDurationSeconds: number | null;
    existingFreeSecondsUsed: number | null;
  };
  /** freeSecondsUsed of this same access identity's OTHER already-finalized sessions today. */
  otherFinalizedSecondsToday: number;
  claimedDurationSeconds: number;
  nowMs?: number;
}): FinalizeComputation {
  const { session, otherFinalizedSecondsToday, claimedDurationSeconds } = params;
  const nowMs = params.nowMs ?? Date.now();

  if (session.usageFinalizedAt !== null) {
    return {
      alreadyFinalized: true,
      durationSeconds: session.existingDurationSeconds ?? 0,
      freeSecondsUsed: session.existingFreeSecondsUsed ?? 0,
    };
  }

  // Defense in depth: clamp the claimed duration to how much wall-clock
  // time has actually passed since the session was created. The real
  // source of truth is the gateway's own monotonic timer — this is just a
  // sanity ceiling on top of that.
  const elapsedCeilingSeconds = Math.max(0, Math.floor((nowMs - new Date(session.createdAt).getTime()) / 1000));
  const safeDuration = Math.max(0, Math.min(claimedDurationSeconds, elapsedCeilingSeconds));

  const freeRemaining = Math.max(0, DAILY_FREE_SECONDS - otherFinalizedSecondsToday);
  const freeUsed = Math.min(freeRemaining, safeDuration);

  return {
    alreadyFinalized: false,
    durationSeconds: safeDuration,
    freeSecondsUsed: freeUsed,
    usageFinalizedAt: new Date(nowMs).toISOString(),
  };
}
