import { describe, it, expect } from "vitest";
import { allocateUsage, usableSeconds } from "./entitlement";

// These cover the client-safe allocation math shared with (and mirrored by)
// the server-authoritative finalize_call_usage() Postgres function in
// supabase/migrations/003_entitlement_foundation.sql. The database-only
// edge cases (idempotency, concurrency, RLS, promotional-grant-once) are
// exercised separately against a live Postgres instance — see the Phase 2
// development report for what was actually run.

describe("entitlement: allocateUsage", () => {
  it("brand new user: 600 free seconds, 0 paid credits, uses only free", () => {
    expect(allocateUsage({ freeSecondsRemaining: 600, paidCreditsRemaining: 0 }, 200)).toEqual({
      freeSecondsUsed: 200,
      paidCreditsUsed: 0,
    });
  });

  it("partially used free allowance: consumes remaining free first", () => {
    expect(allocateUsage({ freeSecondsRemaining: 300, paidCreditsRemaining: 5 }, 360)).toEqual({
      freeSecondsUsed: 300,
      paidCreditsUsed: 1,
    });
  });

  it("all free allowance consumed: falls straight to paid credits", () => {
    expect(allocateUsage({ freeSecondsRemaining: 0, paidCreditsRemaining: 5 }, 120)).toEqual({
      freeSecondsUsed: 0,
      paidCreditsUsed: 2,
    });
  });

  it("paid credits available after free exhausted, combined usage", () => {
    expect(allocateUsage({ freeSecondsRemaining: 120, paidCreditsRemaining: 5 }, 200)).toEqual({
      freeSecondsUsed: 120,
      paidCreditsUsed: 2, // 80 paid seconds needed -> ceil(80/60) = 2
    });
  });

  it("1 second of paid usage costs 1 credit", () => {
    expect(allocateUsage({ freeSecondsRemaining: 0, paidCreditsRemaining: 5 }, 1)).toEqual({
      freeSecondsUsed: 0,
      paidCreditsUsed: 1,
    });
  });

  it("60 seconds of paid usage costs 1 credit", () => {
    expect(allocateUsage({ freeSecondsRemaining: 0, paidCreditsRemaining: 5 }, 60)).toEqual({
      freeSecondsUsed: 0,
      paidCreditsUsed: 1,
    });
  });

  it("61 seconds of paid usage costs 2 credits", () => {
    expect(allocateUsage({ freeSecondsRemaining: 0, paidCreditsRemaining: 5 }, 61)).toEqual({
      freeSecondsUsed: 0,
      paidCreditsUsed: 2,
    });
  });

  it("never spends more credits than are available", () => {
    expect(allocateUsage({ freeSecondsRemaining: 0, paidCreditsRemaining: 2 }, 999)).toEqual({
      freeSecondsUsed: 0,
      paidCreditsUsed: 2,
    });
  });

  it("never allocates negative free or paid usage from a negative balance", () => {
    expect(allocateUsage({ freeSecondsRemaining: -10, paidCreditsRemaining: -5 }, 30)).toEqual({
      freeSecondsUsed: 0,
      paidCreditsUsed: 0,
    });
  });

  it("clamps a negative requested duration to zero usage", () => {
    expect(allocateUsage({ freeSecondsRemaining: 600, paidCreditsRemaining: 5 }, -30)).toEqual({
      freeSecondsUsed: 0,
      paidCreditsUsed: 0,
    });
  });

  it("zero-entitlement user gets zero usage allocated", () => {
    expect(allocateUsage({ freeSecondsRemaining: 0, paidCreditsRemaining: 0 }, 100)).toEqual({
      freeSecondsUsed: 0,
      paidCreditsUsed: 0,
    });
  });
});

describe("entitlement: usableSeconds", () => {
  it("sums free seconds and paid credits converted to seconds", () => {
    expect(usableSeconds({ freeSecondsRemaining: 120, paidCreditsRemaining: 3 })).toBe(300);
  });

  it("is never negative even with a negative balance", () => {
    expect(usableSeconds({ freeSecondsRemaining: -50, paidCreditsRemaining: -2 })).toBe(0);
  });

  it("brand new user has exactly 600 usable seconds", () => {
    expect(usableSeconds({ freeSecondsRemaining: 600, paidCreditsRemaining: 0 })).toBe(600);
  });
});
