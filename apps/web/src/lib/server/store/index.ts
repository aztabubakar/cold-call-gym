import "server-only";
import { memoryCallSessionStore, memoryLeadStore, memorySalesInquiryStore } from "./memory-store";
import { redisCallSessionStore, redisLeadStore, redisSalesInquiryStore, isRedisConfigured } from "./redis-store";
import type { CallSessionStore, LeadStore, SalesInquiryStore } from "./types";

/**
 * The single seam between application code and the backing datastore.
 * Every call site imports leadStore/callSessionStore/salesInquiryStore
 * from HERE, never from memory-store.ts or redis-store.ts directly.
 *
 * Picks the Redis-backed implementation whenever UPSTASH_REDIS_REST_URL /
 * UPSTASH_REDIS_REST_TOKEN are configured (the durable, multi-instance-
 * safe option — required for a real deployment on Vercel, where
 * serverless functions do not share process memory between requests —
 * see redis-store.ts and docs/DEPLOYMENT.md's "Production persistence").
 * Falls back to the in-memory implementation otherwise, so local
 * development keeps working with zero external setup — see
 * memory-store.ts for exactly what that does and does not guarantee.
 *
 * Swapping to a different production datastore later still means writing
 * one new module against the interfaces in ./types and changing what's
 * exported here — no other file in the app needs to change.
 */
const usingRedis = isRedisConfigured();

export const leadStore: LeadStore = usingRedis ? redisLeadStore : memoryLeadStore;
export const callSessionStore: CallSessionStore = usingRedis ? redisCallSessionStore : memoryCallSessionStore;
export const salesInquiryStore: SalesInquiryStore = usingRedis ? redisSalesInquiryStore : memorySalesInquiryStore;

export type { Lead, CallSessionRecord, CallSessionState, SalesInquiry, FinalizeUsageResult } from "./types";
