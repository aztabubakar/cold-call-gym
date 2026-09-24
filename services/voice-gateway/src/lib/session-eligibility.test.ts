import { describe, it, expect } from "vitest";
import { evaluateSessionEligibility } from "./session-eligibility.js";
import type { CallSessionRecord } from "./session-store.js";
import type { VoiceSessionTokenClaims } from "@cold-call-gym/shared";

function makeSession(overrides: Partial<CallSessionRecord> = {}): CallSessionRecord {
  return {
    id: "session-1",
    accessId: "access-1",
    scenarioId: "scenario-1",
    state: "authorized",
    usageFinalizedAt: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeClaims(overrides: Partial<VoiceSessionTokenClaims> = {}): VoiceSessionTokenClaims {
  return {
    sub: "access-1",
    sessionId: "session-1",
    scenarioId: "scenario-1",
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

  it("rejects when the token's access identity does not own the session (cross-identity protection)", () => {
    const result = evaluateSessionEligibility(makeSession({ accessId: "access-2" }), makeClaims());
    expect(result).toEqual({ ok: false, code: "forbidden" });
  });

  it("rejects when the token's scenario does not match the session's scenario", () => {
    const result = evaluateSessionEligibility(makeSession({ scenarioId: "scenario-2" }), makeClaims());
    expect(result).toEqual({ ok: false, code: "forbidden" });
  });

  it("rejects a completed session — a finalized session cannot restart", () => {
    const result = evaluateSessionEligibility(
      makeSession({ state: "completed", usageFinalizedAt: new Date().toISOString() }),
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
