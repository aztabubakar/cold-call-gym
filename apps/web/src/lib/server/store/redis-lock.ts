import "server-only";
import type { Redis } from "@upstash/redis";

/**
 * A short-lived distributed lock, scoped per key. Used by redis-store.ts's
 * finalizeUsage() to serialize concurrent finalize calls for the same
 * access identity across different serverless instances — the network-
 * round-trip equivalent of the in-memory store's "runs synchronously, so
 * JS's single-threaded execution model gives atomicity for free" trick
 * (see memory-store.ts), which stops working once storage lives outside
 * one process. Mirrors the old Postgres design's
 * `pg_advisory_xact_lock(hashtext(user_id))` — same purpose, different
 * mechanism.
 *
 * Implemented with `SET key value NX PX ttl` (atomic in Redis) rather than
 * a check-then-set pair, so two concurrent callers can never both believe
 * they hold the lock.
 */
export async function withLock<T>(
  redis: Redis,
  lockKey: string,
  fn: () => Promise<T>,
  opts: { ttlMs?: number; maxWaitMs?: number; retryDelayMs?: number } = {},
): Promise<T> {
  const ttlMs = opts.ttlMs ?? 5000;
  const maxWaitMs = opts.maxWaitMs ?? 3000;
  const retryDelayMs = opts.retryDelayMs ?? 50;

  const deadline = Date.now() + maxWaitMs;
  let acquired = false;

  while (Date.now() < deadline) {
    const result = await redis.set(lockKey, "1", { nx: true, px: ttlMs });
    if (result === "OK") {
      acquired = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  }

  if (!acquired) {
    throw new Error(`could not acquire lock ${lockKey} within ${maxWaitMs}ms`);
  }

  try {
    return await fn();
  } finally {
    // Best-effort release — the TTL is the real safety net if this fails
    // (a crashed process, a network blip), so a lock never wedges forever.
    await redis.del(lockKey).catch(() => {});
  }
}
