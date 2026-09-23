import "server-only";
import { randomUUID } from "node:crypto";
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

/**
 * In-memory reference implementation of LeadStore / CallSessionStore /
 * SalesInquiryStore.
 *
 * NOT DURABLE, NOT MULTI-INSTANCE-SAFE. This is a development/local
 * implementation only:
 *   - State lives in a plain module-level Map and is lost on every process
 *     restart (including every deploy, and every cold start on a
 *     serverless platform like Vercel).
 *   - It provides no cross-instance consistency: if more than one server
 *     process is running (multiple Vercel serverless invocations, a
 *     horizontally-scaled Node deployment, etc.), each process has its own
 *     independent copy of this data, so a lead's daily usage or a call
 *     session's state can be inconsistent between requests handled by
 *     different instances.
 *   - Observed in `next dev` specifically: Next.js compiles route bundles
 *     on demand, per route, the first time each is requested. Until every
 *     route your test touches has been hit at least once (i.e. this
 *     module's first few requests during dev-server warm-up), different
 *     routes can transiently resolve to different compiled instances of
 *     this module — a lead created via one just-compiled route may not
 *     yet be visible from another. This settles once all touched routes
 *     have been compiled once; `next build && next start` (and a real
 *     production deploy) doesn't have this phase at all, since every
 *     route is compiled ahead of time into one server bundle.
 *   - Within a SINGLE process, correctness is real, not simulated: every
 *     method here runs synchronously to completion (no `await` between
 *     reading and writing shared state), so JavaScript's single-threaded
 *     execution model gives genuine atomicity for concurrent requests
 *     handled by that one process — this is what finalizeUsage() relies on
 *     to reproduce the old Postgres row-lock/advisory-lock behavior.
 *
 * Before a real production launch this MUST be swapped for a durable,
 * shared datastore (Postgres, Redis, etc. — deliberately not chosen here,
 * see docs/DEPLOYMENT.md "Production persistence"). Swapping it means
 * writing a new module that implements the same LeadStore/CallSessionStore
 * /SalesInquiryStore interfaces (types.ts) and changing what index.ts
 * exports — no call site outside this directory needs to change.
 */

const leads = new Map<string, Lead>();
const callSessions = new Map<string, CallSessionRecord>();
const salesInquiries = new Map<string, SalesInquiry>();

export const memoryLeadStore: LeadStore = {
  async create(input) {
    const lead: Lead = {
      id: randomUUID(),
      name: input.name,
      email: input.email,
      phone: input.phone,
      consent: input.consent,
      createdAt: new Date().toISOString(),
    };
    leads.set(lead.id, lead);
    return lead;
  },
  async get(id) {
    return leads.get(id) ?? null;
  },
};

export const memoryCallSessionStore: CallSessionStore = {
  async create(input) {
    const record: CallSessionRecord = {
      id: randomUUID(),
      accessId: input.accessId,
      scenarioId: input.scenarioId,
      scenarioSlug: input.scenarioSlug,
      state: "authorized",
      createdAt: new Date().toISOString(),
      usageFinalizedAt: null,
      durationSeconds: null,
      freeSecondsUsed: null,
    };
    callSessions.set(record.id, record);
    return record;
  },

  async get(id) {
    return callSessions.get(id) ?? null;
  },

  async transitionState(id, state: CallSessionState) {
    const record = callSessions.get(id);
    if (record) record.state = state;
  },

  async markFailed(id) {
    const record = callSessions.get(id);
    if (record) record.state = "failed";
  },

  // Synchronous body (no await) end-to-end: this whole function runs in one
  // turn of the event loop, so it cannot be interleaved with another
  // request's finalizeUsage() call in the same process. See the module
  // doc-comment above for why that matters and where it stops being true.
  async finalizeUsage(params): Promise<FinalizeUsageResult> {
    const record = callSessions.get(params.sessionId);
    if (!record) {
      throw new Error(`call session ${params.sessionId} not found`);
    }

    if (record.state === "failed" && record.usageFinalizedAt === null) {
      throw new Error(`session ${params.sessionId} in state ${record.state} is not eligible for usage finalization`);
    }

    const otherFinalizedSecondsToday = sumUsedToday(
      Array.from(callSessions.values()).filter((r) => r.accessId === record.accessId && r.id !== record.id),
    );

    const result = computeFinalize({
      session: {
        createdAt: record.createdAt,
        usageFinalizedAt: record.usageFinalizedAt,
        state: record.state,
        existingDurationSeconds: record.durationSeconds,
        existingFreeSecondsUsed: record.freeSecondsUsed,
      },
      otherFinalizedSecondsToday,
      claimedDurationSeconds: params.durationSeconds,
    });

    if (!result.alreadyFinalized) {
      record.state = "completed";
      record.durationSeconds = result.durationSeconds;
      record.freeSecondsUsed = result.freeSecondsUsed;
      record.usageFinalizedAt = result.usageFinalizedAt;
    }

    return {
      sessionId: record.id,
      state: record.state,
      durationSeconds: result.durationSeconds,
      freeSecondsUsed: result.freeSecondsUsed,
      alreadyFinalized: result.alreadyFinalized,
    };
  },

  async usedTodaySeconds(accessId) {
    return sumUsedToday(Array.from(callSessions.values()).filter((r) => r.accessId === accessId));
  },

  async recentForAccess(accessId, limit) {
    return Array.from(callSessions.values())
      .filter((r) => r.accessId === accessId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, limit);
  },

  async countSince(accessId, sinceIso) {
    let count = 0;
    for (const record of callSessions.values()) {
      if (record.accessId === accessId && record.createdAt >= sinceIso) count += 1;
    }
    return count;
  },
};

export const memorySalesInquiryStore: SalesInquiryStore = {
  async create(input) {
    const inquiry: SalesInquiry = {
      ...input,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    salesInquiries.set(inquiry.id, inquiry);
    return inquiry;
  },
};
