import "server-only";
import { randomUUID } from "node:crypto";
import { Redis } from "@upstash/redis";
import type {
  CallSessionRecord,
  CallSessionState,
  CallSessionStore,
  FinalizeUsageResult,
  Lead,
  LeadStore,
  SalesInquiry,
  SalesInquiryStore,
} from "./types";
import { computeFinalize, sumUsedToday } from "./usage-math";
import { withLock } from "./redis-lock";

/**
 * Upstash Redis-backed implementation of LeadStore / CallSessionStore /
 * SalesInquiryStore — the durable, multi-instance-safe counterpart to
 * memory-store.ts. Selected automatically by ./index.ts whenever
 * UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are configured (set
 * these in Vercel's project settings — adding the Upstash integration
 * from Vercel's Storage tab populates them automatically).
 *
 * Uses the REST-based @upstash/redis client (not a persistent TCP
 * connection), which is what makes this safe to use from Vercel
 * serverless functions — no connection-pooling/cold-start problems.
 *
 * Data model:
 *   lead:{id}                  -> Lead (JSON, auto (de)serialized by the client)
 *   session:{id}                -> CallSessionRecord (JSON)
 *   sessions_by_access:{accessId} -> Set<sessionId> (secondary index)
 *   sales_inquiry:{id}          -> SalesInquiry (JSON)
 *
 * Concurrency: unlike memory-store.ts (which gets atomicity for free from
 * running synchronously within one process — see its doc comment),
 * network round-trips here mean finalizeUsage() needs a real distributed
 * lock, scoped per session, so a read-modify-write race can't finalize the
 * same session's usage twice — see redis-lock.ts.
 */

const LEAD_TTL_SECONDS = 180 * 24 * 60 * 60; // matches the access cookie's own 180-day lifetime (see access.ts)
const SESSION_TTL_SECONDS = 35 * 24 * 60 * 60; // generous margin past the 7-day "calls this week" dashboard window

function leadKey(id: string): string {
  return `lead:${id}`;
}
function sessionKey(id: string): string {
  return `session:${id}`;
}
function sessionsByAccessKey(accessId: string): string {
  return `sessions_by_access:${accessId}`;
}
function salesInquiryKey(id: string): string {
  return `sales_inquiry:${id}`;
}
function finalizeLockKey(sessionId: string): string {
  return `lock:finalize:${sessionId}`;
}

let client: Redis | null = null;

function getRedis(): Redis {
  if (client) return client;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new Error("UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are not configured");
  }
  client = new Redis({ url, token });
  return client;
}

export function isRedisConfigured(): boolean {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

async function getSessionsForAccess(redis: Redis, accessId: string): Promise<CallSessionRecord[]> {
  const ids = await redis.smembers(sessionsByAccessKey(accessId));
  if (ids.length === 0) return [];
  const records = await Promise.all(ids.map((id) => redis.get<CallSessionRecord>(sessionKey(id))));
  return records.filter((r): r is CallSessionRecord => r !== null);
}

export const redisLeadStore: LeadStore = {
  async create(input) {
    const redis = getRedis();
    const lead: Lead = {
      id: randomUUID(),
      name: input.name,
      email: input.email,
      phone: input.phone,
      consent: input.consent,
      createdAt: new Date().toISOString(),
    };
    await redis.set(leadKey(lead.id), lead, { ex: LEAD_TTL_SECONDS });
    return lead;
  },

  async get(id) {
    const redis = getRedis();
    return (await redis.get<Lead>(leadKey(id))) ?? null;
  },
};

export const redisCallSessionStore: CallSessionStore = {
  async create(input) {
    const redis = getRedis();
    const record: CallSessionRecord = {
      id: randomUUID(),
      accessId: input.accessId,
      scenarioId: input.scenarioId,
      scenarioSlug: input.scenarioSlug,
      state: "authorized",
      createdAt: new Date().toISOString(),
      usageFinalizedAt: null,
      durationSeconds: null,
    };
    await Promise.all([
      redis.set(sessionKey(record.id), record, { ex: SESSION_TTL_SECONDS }),
      redis.sadd(sessionsByAccessKey(input.accessId), record.id),
      redis.expire(sessionsByAccessKey(input.accessId), SESSION_TTL_SECONDS),
    ]);
    return record;
  },

  async get(id) {
    const redis = getRedis();
    return (await redis.get<CallSessionRecord>(sessionKey(id))) ?? null;
  },

  async transitionState(id, state: CallSessionState) {
    const redis = getRedis();
    const record = await redis.get<CallSessionRecord>(sessionKey(id));
    if (!record) return;
    record.state = state;
    await redis.set(sessionKey(id), record, { ex: SESSION_TTL_SECONDS });
  },

  async markFailed(id) {
    const redis = getRedis();
    const record = await redis.get<CallSessionRecord>(sessionKey(id));
    if (!record) return;
    record.state = "failed";
    await redis.set(sessionKey(id), record, { ex: SESSION_TTL_SECONDS });
  },

  async finalizeUsage(params): Promise<FinalizeUsageResult> {
    const redis = getRedis();
    const initial = await redis.get<CallSessionRecord>(sessionKey(params.sessionId));
    if (!initial) {
      throw new Error(`call session ${params.sessionId} not found`);
    }

    return withLock(redis, finalizeLockKey(initial.id), async () => {
      // Re-read inside the lock in case another finalize for this exact
      // session raced the read above.
      const fresh = (await redis.get<CallSessionRecord>(sessionKey(params.sessionId))) ?? initial;

      if (fresh.state === "failed" && fresh.usageFinalizedAt === null) {
        throw new Error(
          `session ${params.sessionId} in state ${fresh.state} is not eligible for usage finalization`,
        );
      }

      const result = computeFinalize({
        session: {
          createdAt: fresh.createdAt,
          usageFinalizedAt: fresh.usageFinalizedAt,
          existingDurationSeconds: fresh.durationSeconds,
        },
        claimedDurationSeconds: params.durationSeconds,
      });

      if (!result.alreadyFinalized) {
        fresh.state = "completed";
        fresh.durationSeconds = result.durationSeconds;
        fresh.usageFinalizedAt = result.usageFinalizedAt;
        await redis.set(sessionKey(fresh.id), fresh, { ex: SESSION_TTL_SECONDS });
      }

      return {
        sessionId: fresh.id,
        state: fresh.state,
        durationSeconds: result.durationSeconds,
        alreadyFinalized: result.alreadyFinalized,
      };
    });
  },

  async usedTodaySeconds(accessId) {
    const redis = getRedis();
    return sumUsedToday(await getSessionsForAccess(redis, accessId));
  },

  async recentForAccess(accessId, limit) {
    const redis = getRedis();
    const records = await getSessionsForAccess(redis, accessId);
    return records.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, limit);
  },

  async countSince(accessId, sinceIso) {
    const redis = getRedis();
    const records = await getSessionsForAccess(redis, accessId);
    return records.filter((r) => r.createdAt >= sinceIso).length;
  },
};

export const redisSalesInquiryStore: SalesInquiryStore = {
  async create(input) {
    const redis = getRedis();
    const inquiry: SalesInquiry = {
      ...input,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    await redis.set(salesInquiryKey(inquiry.id), inquiry, { ex: LEAD_TTL_SECONDS });
    return inquiry;
  },
};
