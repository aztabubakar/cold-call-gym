import { describe, it, expect } from "vitest";
import { computeFinalize, sumUsedToday, startOfUtcDayIso } from "./usage-math";

const NOON_UTC_MS = Date.UTC(2026, 0, 15, 12, 0, 0);

describe("sumUsedToday", () => {
  it("counts only sessions finalized today (UTC)", () => {
    const todayStart = startOfUtcDayIso(NOON_UTC_MS);
    const yesterday = new Date(NOON_UTC_MS - 24 * 60 * 60 * 1000).toISOString();

    const total = sumUsedToday(
      [
        { usageFinalizedAt: todayStart, durationSeconds: 100 },
        { usageFinalizedAt: yesterday, durationSeconds: 500 }, // must not count
        { usageFinalizedAt: null, durationSeconds: null }, // never finalized, must not count
      ],
      NOON_UTC_MS,
    );

    expect(total).toBe(100);
  });

  it("sums across multiple sessions finalized today", () => {
    const todayStart = startOfUtcDayIso(NOON_UTC_MS);
    const total = sumUsedToday(
      [
        { usageFinalizedAt: todayStart, durationSeconds: 200 },
        { usageFinalizedAt: todayStart, durationSeconds: 150 },
      ],
      NOON_UTC_MS,
    );
    expect(total).toBe(350);
  });

  it("a session finalized exactly at yesterday's UTC boundary does not count today", () => {
    const todayStart = new Date(startOfUtcDayIso(NOON_UTC_MS));
    const oneMsBeforeMidnight = new Date(todayStart.getTime() - 1).toISOString();
    const total = sumUsedToday([{ usageFinalizedAt: oneMsBeforeMidnight, durationSeconds: 999 }], NOON_UTC_MS);
    expect(total).toBe(0);
  });
});

describe("computeFinalize", () => {
  function session(overrides: Partial<Parameters<typeof computeFinalize>[0]["session"]> = {}) {
    return {
      createdAt: new Date(NOON_UTC_MS - 10_000).toISOString(),
      usageFinalizedAt: null,
      existingDurationSeconds: null,
      ...overrides,
    };
  }

  it("records the full claimed duration — calls are free and unlimited, nothing is capped", () => {
    const result = computeFinalize({
      session: session({ createdAt: new Date(NOON_UTC_MS - 100_000).toISOString() }),
      claimedDurationSeconds: 45,
      nowMs: NOON_UTC_MS,
    });
    expect(result).toMatchObject({ alreadyFinalized: false, durationSeconds: 45 });
  });

  it("records a large claimed duration in full when it's within wall-clock elapsed time", () => {
    const result = computeFinalize({
      session: session({ createdAt: new Date(NOON_UTC_MS - 10_000_000).toISOString() }),
      claimedDurationSeconds: 9_000,
      nowMs: NOON_UTC_MS,
    });
    expect(result).toMatchObject({ alreadyFinalized: false, durationSeconds: 9_000 });
  });

  it("clamps an implausible claimed duration to wall-clock time elapsed since creation", () => {
    const result = computeFinalize({
      session: session({ createdAt: new Date(NOON_UTC_MS - 5_000).toISOString() }), // 5s ago
      claimedDurationSeconds: 999_999, // implausible
      nowMs: NOON_UTC_MS,
    });
    expect(result).toMatchObject({ alreadyFinalized: false, durationSeconds: 5 });
  });

  it("never produces a negative durationSeconds", () => {
    const result = computeFinalize({
      session: session({ createdAt: new Date(NOON_UTC_MS + 5_000).toISOString() }), // created "in the future"
      claimedDurationSeconds: 60,
      nowMs: NOON_UTC_MS,
    });
    expect(result.durationSeconds).toBe(0);
  });

  it("is idempotent: finalizing an already-finalized session returns the original result unchanged", () => {
    const result = computeFinalize({
      session: session({
        usageFinalizedAt: new Date(NOON_UTC_MS - 1000).toISOString(),
        existingDurationSeconds: 42,
      }),
      claimedDurationSeconds: 999, // a retried/duplicate call with a different duration must not matter
      nowMs: NOON_UTC_MS,
    });
    expect(result).toEqual({ alreadyFinalized: true, durationSeconds: 42 });
  });

  it("finalizes a zero-duration call with zero usage", () => {
    const result = computeFinalize({
      session: session(),
      claimedDurationSeconds: 0,
      nowMs: NOON_UTC_MS,
    });
    expect(result).toMatchObject({ alreadyFinalized: false, durationSeconds: 0 });
  });
});
