import { describe, it, expect } from "vitest";
import { evaluateSessionEligibility } from "./session-eligibility.js";
import type { CallSessionRow } from "./supabase.js";
import type { VoiceSessionTokenClaims } from "@cold-call-gym/shared";

function makeSession(overrides: Partial<CallSessionRow> = {}): CallSessionRow {
  return {
    id: "session-1",
    user_id: "user-1",
    scenario_id: "scenario-1",
    state: "authorized",
    usage_finalized_at: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeClaims(overrides: Partial<VoiceSessionTokenClaims> = {}): VoiceSessionTokenClaims {
  return {
    sub: "user-1",
    sessionId: "session-1",
    scenarioId: "scenario-1",
    maxAllowedSeconds: 120,
    iat: 0,
    exp: 9_999_999_999,
    jti: "jti-1",
    ...overrides,
  };
}

describe("evaluateSessionEligibility", () => {
  it("accepts a matching, authorized session", () => {
    expect(evaluateSessionEligibility(makeSession(), makeClaims())).toEqual({ ok: true });
  });

  it("rejects when the token's user does not own the session (cross-user protection)", () => {
    const result = evaluateSessionEligibility(makeSession({ user_id: "user-2" }), makeClaims());
    expect(result).toEqual({ ok: false, code: "forbidden" });
  });

  it("rejects when the token's scenario does not match the session's scenario", () => {
    const result = evaluateSessionEligibility(makeSession({ scenario_id: "scenario-2" }), makeClaims());
    expect(result).toEqual({ ok: false, code: "forbidden" });
  });

  it("rejects a completed session — a finalized session cannot restart", () => {
    const result = evaluateSessionEligibility(
      makeSession({ state: "completed", usage_finalized_at: new Date().toISOString() }),
      makeClaims(),
    );
    expect(result).toEqual({ ok: false, code: "conflict" });
  });

  it("rejects a failed session", () => {
    const result = evaluateSessionEligibility(makeSession({ state: "failed" }), makeClaims());
    expect(result).toEqual({ ok: false, code: "conflict" });
  });

  it("rejects a session that is already connecting/active elsewhere", () => {
    expect(evaluateSessionEligibility(makeSession({ state: "connecting" }), makeClaims())).toEqual({
      ok: false,
      code: "conflict",
    });
    expect(evaluateSessionEligibility(makeSession({ state: "active" }), makeClaims())).toEqual({
      ok: false,
      code: "conflict",
    });
  });

  it("rejects a `created` session that was never authorized", () => {
    const result = evaluateSessionEligibility(makeSession({ state: "created" }), makeClaims());
    expect(result).toEqual({ ok: false, code: "conflict" });
  });
});
