import { describe, it, expect, vi } from "vitest";

// redis-lock.ts carries `import "server-only"` as a defense-in-depth guard
// against accidental client bundling — that package throws when evaluated
// outside Next.js's server-rendering context, which plain Vitest doesn't
// provide. No-op it for this test only; production behavior is untouched.
vi.mock("server-only", () => ({}));

const { withLock } = await import("./redis-lock");

/** Minimal fake matching just the `set`/`del` surface withLock uses, with real Redis NX semantics. */
class FakeRedis {
  private store = new Map<string, string>();

  async set(key: string, value: string, opts?: { nx?: boolean; px?: number }): Promise<"OK" | null> {
    if (opts?.nx && this.store.has(key)) return null;
    this.store.set(key, value);
    return "OK";
  }

  async del(key: string): Promise<number> {
    const existed = this.store.has(key);
    this.store.delete(key);
    return existed ? 1 : 0;
  }
}

describe("withLock", () => {
  it("runs the function and releases the lock afterward", async () => {
    const redis = new FakeRedis() as never;
    const result = await withLock(redis, "lock:a", async () => "done");
    expect(result).toBe("done");

    // Lock released — acquiring it again immediately should succeed.
    const second = await withLock(redis, "lock:a", async () => "again");
    expect(second).toBe("again");
  });

  it("releases the lock even if the function throws", async () => {
    const redis = new FakeRedis() as never;
    await expect(
      withLock(redis, "lock:b", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    const after = await withLock(redis, "lock:b", async () => "ok-after-failure");
    expect(after).toBe("ok-after-failure");
  });

  it("serializes two concurrent callers on the same key", async () => {
    const redis = new FakeRedis() as never;
    const order: string[] = [];

    const first = withLock(redis, "lock:c", async () => {
      order.push("first-start");
      await new Promise((r) => setTimeout(r, 20));
      order.push("first-end");
    });
    // Give the first call a head start so it wins the race for the lock.
    await new Promise((r) => setTimeout(r, 5));
    const second = withLock(redis, "lock:c", async () => {
      order.push("second-start");
    });

    await Promise.all([first, second]);
    expect(order).toEqual(["first-start", "first-end", "second-start"]);
  });

  it("throws if the lock cannot be acquired within maxWaitMs", async () => {
    const redis = new FakeRedis() as never;
    // Hold the lock open by never letting the first call finish quickly.
    const blocker = withLock(redis, "lock:d", () => new Promise((r) => setTimeout(r, 500)));

    await expect(
      withLock(redis, "lock:d", async () => "should not run", { maxWaitMs: 50, retryDelayMs: 10 }),
    ).rejects.toThrow(/could not acquire lock/);

    await blocker;
  });
});
