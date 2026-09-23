import { describe, it, expect } from "vitest";
import { computeFinalize, computeRemainingSeconds, sumUsedToday, startOfUtcDayIso } from "./usage-math";

const NOON_UTC_MS = Date.UTC(2026, 0, 15, 12, 0, 0);

describe("computeRemainingSeconds", () => {
  it("returns the full 600s when nothing has been used", () => {
    expect(computeRemainingSeconds(0)).toBe(600);
  });

  it("returns 1s remaining after 599s used", () => {
    expect(computeRemainingSeconds(599)).toBe(1);
  });

  it("returns 0s remaining after exactly 600s used", () => {
    expect(computeRemainingSeconds(600)).toBe(0);
  });

  it("never goes negative even if used exceeds the daily limit", () => {
    expect(computeRemainingSeconds(900)).toBe(0);
  });
});

describe("sumUsedToday", () => {
  it("counts only sessions finalized today (UTC)", () => {
    const todayStart = startOfUtcDayIso(NOON_UTC_MS);
    const yesterday = new Date(NOON_UTC_MS - 24 * 60 * 60 * 1000).toISOString();

    const total = sumUsedToday(
      [
        { usageFinalizedAt: todayStart, freeSecondsUsed: 100 },
        { usageFinalizedAt: yesterday, freeSecondsUsed: 500 }, // must not count
        { usageFinalizedAt: null, freeSecondsUsed: null }, // never finalized, must not count
      ],
      NOON_UTC_MS,
    );

    expect(total).toBe(100);
  });

  it("sums across multiple sessions finalized today", () => {
    const todayStart = startOfUtcDayIso(NOON_UTC_MS);
    const total = sumUsedToday(
      [
        { usageFinalizedAt: todayStart, freeSecondsUsed: 200 },
        { usageFinalizedAt: todayStart, freeSecondsUsed: 150 },
      ],
      NOON_UTC_MS,
    );
    expect(total).toBe(350);
  });

  it("a session finalized exactly at yesterday's UTC boundary does not count today", () => {
    const todayStart = new Date(startOfUtcDayIso(NOON_UTC_MS));
    const oneMsBeforeMidnight = new Date(todayStart.getTime() - 1).toISOString();
    const total = sumUsedToday([{ usageFinalizedAt: oneMsBeforeMidnight, freeSecondsUsed: 999 }], NOON_UTC_MS);
    expect(total).toBe(0);
  });
});

describe("computeFinalize", () => {
  function session(overrides: Partial<Parameters<typeof computeFinalize>[0]["session"]> = {}) {
    return {
      createdAt: new Date(NOON_UTC_MS - 10_000).toISOString(),
      usageFinalizedAt: null,
      state: "active",
      existingDurationSeconds: null,
      existingFreeSecondsUsed: null,
      ...overrides,
    };
  }

  it("records the full claimed duration when nothing else has been used today", () => {
    const result = computeFinalize({
      session: session({ createdAt: new Date(NOON_UTC_MS - 100_000).toISOString() }),
      otherFinalizedSecondsToday: 0,
      claimedDurationSeconds: 45,
      nowMs: NOON_UTC_MS,
    });
    expect(result).toMatchObject({ alreadyFinalized: false, durationSeconds: 45, freeSecondsUsed: 45 });
  });

  it("caps free_seconds_used at exactly what's left of the daily allowance (599 used -> 1 more allowed)", () => {
    const result = computeFinalize({
      session: session({ createdAt: new Date(NOON_UTC_MS - 100_000).toISOString() }),
      otherFinalizedSecondsToday: 599,
      claimedDurationSeconds: 10,
      nowMs: NOON_UTC_MS,
    });
    expect(result).toMatchObject({ alreadyFinalized: false, freeSecondsUsed: 1 });
  });

  it("caps free_seconds_used at 0 once the daily allowance is already exhausted", () => {
    const result = computeFinalize({
      session: session({ createdAt: new Date(NOON_UTC_MS - 100_000).toISOString() }),
      otherFinalizedSecondsToday: 600,
      claimedDurationSeconds: 30,
      nowMs: NOON_UTC_MS,
    });
    expect(result).toMatchObject({ alreadyFinalized: false, freeSecondsUsed: 0 });
    // durationSeconds still records the true call length; only the
    // allowance-affecting field is capped.
    expect(result).toMatchObject({ durationSeconds: 30 });
  });

  it("never produces a negative freeSecondsUsed", () => {
    const result = computeFinalize({
      session: session({ createdAt: new Date(NOON_UTC_MS - 100_000).toISOString() }),
      otherFinalizedSecondsToday: 10_000,
      claimedDurationSeconds: 60,
      nowMs: NOON_UTC_MS,
    });
    expect(result.freeSecondsUsed).toBe(0);
    expect(result.freeSecondsUsed).toBeGreaterThanOrEqual(0);
  });

  it("clamps an implausible claimed duration to wall-clock time elapsed since creation", () => {
    const result = computeFinalize({
      session: session({ createdAt: new Date(NOON_UTC_MS - 5_000).toISOString() }), // 5s ago
      otherFinalizedSecondsToday: 0,
      claimedDurationSeconds: 999_999, // implausible
      nowMs: NOON_UTC_MS,
    });
    expect(result).toMatchObject({ alreadyFinalized: false, durationSeconds: 5, freeSecondsUsed: 5 });
  });

  it("is idempotent: finalizing an already-finalized session returns the original result unchanged", () => {
    const result = computeFinalize({
      session: session({
        usageFinalizedAt: new Date(NOON_UTC_MS - 1000).toISOString(),
        existingDurationSeconds: 42,
        existingFreeSecondsUsed: 42,
      }),
      otherFinalizedSecondsToday: 100,
      claimedDurationSeconds: 999, // a retried/duplicate call with a different duration must not matter
      nowMs: NOON_UTC_MS,
    });
    expect(result).toEqual({ alreadyFinalized: true, durationSeconds: 42, freeSecondsUsed: 42 });
  });

  it("finalizes a zero-duration call with zero usage", () => {
    const result = computeFinalize({
      session: session(),
      otherFinalizedSecondsToday: 0,
      claimedDurationSeconds: 0,
      nowMs: NOON_UTC_MS,
    });
    expect(result).toMatchObject({ alreadyFinalized: false, durationSeconds: 0, freeSecondsUsed: 0 });
  });
});
