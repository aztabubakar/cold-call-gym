/**
 * Pure usage/finalization math, extracted out of memory-store.ts so it can
 * be unit-tested directly (memory-store.ts carries `import "server-only"`,
 * which throws under plain Vitest — the same reason
 * lib/contact-sales-schema.ts is split from lib/server/contact-sales.ts).
 * Calls are free and unlimited (see docs/MONETIZATION.md) — this only
 * clamps a claimed duration against wall-clock reality, it never caps
 * against any allowance.
 */

export function startOfUtcDayIso(nowMs: number = Date.now()): string {
  const d = new Date(nowMs);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

/** Sums finalized call duration for today (UTC) — informational only. */
export function sumUsedToday(
  records: { usageFinalizedAt: string | null; durationSeconds: number | null }[],
  nowMs: number = Date.now(),
): number {
  const todayStart = startOfUtcDayIso(nowMs);
  let total = 0;
  for (const r of records) {
    if (r.usageFinalizedAt !== null && r.usageFinalizedAt >= todayStart) {
      total += r.durationSeconds ?? 0;
    }
  }
  return total;
}

export type FinalizeComputation =
  | { alreadyFinalized: true; durationSeconds: number }
  | { alreadyFinalized: false; durationSeconds: number; usageFinalizedAt: string };

/**
 * Computes the result of finalizing one session's duration. Never mutates
 * anything — the caller (memory-store.ts / redis-store.ts) is responsible
 * for applying the result.
 */
export function computeFinalize(params: {
  session: {
    createdAt: string;
    usageFinalizedAt: string | null;
    existingDurationSeconds: number | null;
  };
  claimedDurationSeconds: number;
  nowMs?: number;
}): FinalizeComputation {
  const { session, claimedDurationSeconds } = params;
  const nowMs = params.nowMs ?? Date.now();

  if (session.usageFinalizedAt !== null) {
    return {
      alreadyFinalized: true,
      durationSeconds: session.existingDurationSeconds ?? 0,
    };
  }

  // Defense in depth: clamp the claimed duration to how much wall-clock
  // time has actually passed since the session was created. The real
  // source of truth is the gateway's own monotonic timer — this is just a
  // sanity ceiling on top of that.
  const elapsedCeilingSeconds = Math.max(0, Math.floor((nowMs - new Date(session.createdAt).getTime()) / 1000));
  const safeDuration = Math.max(0, Math.min(claimedDurationSeconds, elapsedCeilingSeconds));

  return {
    alreadyFinalized: false,
    durationSeconds: safeDuration,
    usageFinalizedAt: new Date(nowMs).toISOString(),
  };
}
