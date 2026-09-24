import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// redis-store.ts carries `import "server-only"` as a defense-in-depth
// guard against accidental client bundling — that package throws when
// evaluated outside Next.js's server-rendering context, which plain
// Vitest doesn't provide. No-op it for this test only; production
// behavior is untouched.
vi.mock("server-only", () => ({}));

/**
 * Fake Redis with real NX/SET/GET/SADD/SMEMBERS semantics, enough to
 * exercise redis-store.ts's actual logic (key naming, the finalize lock,
 * the secondary sessions-by-access index) without a live Redis instance —
 * same approach as mocking @google/genai for GeminiLiveProvider's tests.
 */
class FakeRedis {
  store = new Map<string, unknown>();
  sets = new Map<string, Set<string>>();

  async set(key: string, value: unknown, opts?: { ex?: number; nx?: boolean; px?: number }) {
    if (opts?.nx && this.store.has(key)) return null;
    this.store.set(key, value);
    return "OK";
  }
  async get<T>(key: string): Promise<T | null> {
    return (this.store.has(key) ? (this.store.get(key) as T) : null) ?? null;
  }
  async del(key: string) {
    const existed = this.store.has(key);
    this.store.delete(key);
    return existed ? 1 : 0;
  }
  async sadd(key: string, ...members: string[]) {
    const set = this.sets.get(key) ?? new Set<string>();
    for (const m of members) set.add(m);
    this.sets.set(key, set);
    return members.length;
  }
  async smembers(key: string) {
    return Array.from(this.sets.get(key) ?? []);
  }
  async expire(_key: string, _seconds: number) {
    return 1;
  }
}

let fakeRedisInstance: FakeRedis;

vi.mock("@upstash/redis", () => {
  return {
    Redis: vi.fn().mockImplementation(() => fakeRedisInstance),
  };
});

const NOON_UTC_MS = Date.UTC(2026, 0, 15, 12, 0, 0);

describe("redis-store", () => {
  beforeEach(() => {
    fakeRedisInstance = new FakeRedis();
    process.env.UPSTASH_REDIS_REST_URL = "https://fake.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "fake-token";
    vi.useFakeTimers();
    vi.setSystemTime(NOON_UTC_MS);
  });

  afterEach(() => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    vi.useRealTimers();
    vi.resetModules();
  });

  it("isRedisConfigured reflects whether both env vars are set", async () => {
    const { isRedisConfigured } = await import("./redis-store");
    expect(isRedisConfigured()).toBe(true);

    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    expect(isRedisConfigured()).toBe(false);
  });

  it("creates and reads back a lead", async () => {
    const { redisLeadStore } = await import("./redis-store");
    const lead = await redisLeadStore.create({
      name: "Jordan Blake",
      email: "jordan@example.com",
      phone: "+15550001111",
      consent: true,
    });

    expect(lead.id).toBeTruthy();
    const fetched = await redisLeadStore.get(lead.id);
    expect(fetched).toEqual(lead);
  });

  it("returns null for an unknown lead id", async () => {
    const { redisLeadStore } = await import("./redis-store");
    expect(await redisLeadStore.get("does-not-exist")).toBeNull();
  });

  it("creates a call session in the authorized state", async () => {
    const { redisCallSessionStore } = await import("./redis-store");
    const record = await redisCallSessionStore.create({
      accessId: "access-1",
      scenarioId: "busy-vp",
      scenarioSlug: "busy-vp",
    });
    expect(record.state).toBe("authorized");
    expect(record.usageFinalizedAt).toBeNull();
  });

  it("finalizes usage and records it against the access identity's daily total", async () => {
    const { redisCallSessionStore } = await import("./redis-store");
    const record = await redisCallSessionStore.create({
      accessId: "access-1",
      scenarioId: "busy-vp",
      scenarioSlug: "busy-vp",
    });

    vi.advanceTimersByTime(30_000); // 30s of "elapsed" wall-clock time since creation

    const result = await redisCallSessionStore.finalizeUsage({
      sessionId: record.id,
      durationSeconds: 20,
      idempotencyKey: `usage:${record.id}`,
    });

    expect(result).toMatchObject({ alreadyFinalized: false, durationSeconds: 20 });
    expect(await redisCallSessionStore.usedTodaySeconds("access-1")).toBe(20);
  });

  it("is idempotent: finalizing the same session twice returns the original result", async () => {
    const { redisCallSessionStore } = await import("./redis-store");
    const record = await redisCallSessionStore.create({
      accessId: "access-2",
      scenarioId: "busy-vp",
      scenarioSlug: "busy-vp",
    });
    vi.advanceTimersByTime(30_000);

    const first = await redisCallSessionStore.finalizeUsage({
      sessionId: record.id,
      durationSeconds: 10,
      idempotencyKey: `usage:${record.id}`,
    });
    const second = await redisCallSessionStore.finalizeUsage({
      sessionId: record.id,
      durationSeconds: 999, // a retried/duplicate call with a different duration must not matter
      idempotencyKey: `usage:${record.id}`,
    });

    expect(second).toEqual({ ...first, alreadyFinalized: true });
    expect(await redisCallSessionStore.usedTodaySeconds("access-2")).toBe(10);
  });

  it("sums multiple sessions' full duration for the same access identity — no cap across sessions", async () => {
    const { redisCallSessionStore } = await import("./redis-store");
    const accessId = "access-3";

    const first = await redisCallSessionStore.create({ accessId, scenarioId: "s", scenarioSlug: "s" });
    vi.advanceTimersByTime(700_000);
    await redisCallSessionStore.finalizeUsage({
      sessionId: first.id,
      durationSeconds: 599,
      idempotencyKey: `usage:${first.id}`,
    });

    const second = await redisCallSessionStore.create({ accessId, scenarioId: "s", scenarioSlug: "s" });
    vi.advanceTimersByTime(30_000);
    const result = await redisCallSessionStore.finalizeUsage({
      sessionId: second.id,
      durationSeconds: 10,
      idempotencyKey: `usage:${second.id}`,
    });

    expect(result.durationSeconds).toBe(10);
    expect(await redisCallSessionStore.usedTodaySeconds(accessId)).toBe(609);
  });

  it("recentForAccess returns only this access identity's sessions, newest first", async () => {
    const { redisCallSessionStore } = await import("./redis-store");
    const a = await redisCallSessionStore.create({ accessId: "access-4", scenarioId: "s", scenarioSlug: "s" });
    vi.advanceTimersByTime(1000);
    const b = await redisCallSessionStore.create({ accessId: "access-4", scenarioId: "s", scenarioSlug: "s" });
    await redisCallSessionStore.create({ accessId: "someone-else", scenarioId: "s", scenarioSlug: "s" });

    const recent = await redisCallSessionStore.recentForAccess("access-4", 5);
    expect(recent.map((r) => r.id)).toEqual([b.id, a.id]);
  });

  it("countSince only counts sessions created on/after the given timestamp", async () => {
    const { redisCallSessionStore } = await import("./redis-store");
    const accessId = "access-5";
    await redisCallSessionStore.create({ accessId, scenarioId: "s", scenarioSlug: "s" });
    const cutoff = new Date(NOON_UTC_MS + 1000).toISOString();
    vi.advanceTimersByTime(2000);
    await redisCallSessionStore.create({ accessId, scenarioId: "s", scenarioSlug: "s" });

    expect(await redisCallSessionStore.countSince(accessId, cutoff)).toBe(1);
  });

  it("throws finalizing a session that never became eligible (failed, never active)", async () => {
    const { redisCallSessionStore } = await import("./redis-store");
    const record = await redisCallSessionStore.create({ accessId: "access-6", scenarioId: "s", scenarioSlug: "s" });
    await redisCallSessionStore.markFailed(record.id);

    await expect(
      redisCallSessionStore.finalizeUsage({
        sessionId: record.id,
        durationSeconds: 5,
        idempotencyKey: `usage:${record.id}`,
      }),
    ).rejects.toThrow(/not eligible/);
  });

  it("records a sales inquiry", async () => {
    const { redisSalesInquiryStore } = await import("./redis-store");
    const inquiry = await redisSalesInquiryStore.create({
      leadId: null,
      name: "Jamie",
      workEmail: "jamie@company.com",
      company: "Acme",
      jobTitle: null,
      teamSize: null,
      phone: null,
      expectedUsage: null,
      message: null,
    });
    expect(inquiry.id).toBeTruthy();
    expect(inquiry.createdAt).toBeTruthy();
  });
});
