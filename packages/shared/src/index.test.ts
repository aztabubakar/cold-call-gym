import { describe, it, expect } from "vitest";
import {
  formatDuration,
  DAILY_FREE_SECONDS,
  DEFAULT_GEMINI_MODEL,
  GEMINI_INPUT_SAMPLE_RATE_HZ,
  GEMINI_OUTPUT_SAMPLE_RATE_HZ,
  MAX_AUDIO_CHUNK_BASE64_CHARS,
  computeMaxAllowedSeconds,
  ScenarioSchema,
  FreeEntitlementSchema,
  CallAuthorizationSchema,
  VoiceSessionTokenClaimsSchema,
  ClientToGatewayMessageSchema,
  GatewayToClientEventSchema,
} from "./index.js";

describe("formatDuration", () => {
  it("pads minutes and seconds", () => expect(formatDuration(65)).toBe("01:05"));
  it("floors fractional seconds", () => expect(formatDuration(59.9)).toBe("00:59"));
  it("clamps negative input to zero", () => expect(formatDuration(-10)).toBe("00:00"));
});

describe("DAILY_FREE_SECONDS", () => {
  it("is 10 minutes", () => expect(DAILY_FREE_SECONDS).toBe(600));
});

describe("computeMaxAllowedSeconds", () => {
  // Cold Call Gym has no paid credits — a call is authorized for exactly
  // whatever remains of today's free allowance, with no separate
  // independent per-call ceiling. The browser has no way to widen this
  // (see VoiceSessionTokenClaimsSchema's tamper test in
  // services/voice-gateway/src/lib/token.test.ts).
  it("1 second remaining authorizes a max of 1 second", () => {
    expect(computeMaxAllowedSeconds(1)).toBe(1);
  });

  it("300 seconds remaining authorizes a max of 300 seconds", () => {
    expect(computeMaxAllowedSeconds(300)).toBe(300);
  });

  it("a large remaining value is authorized in full — there is no separate per-call ceiling", () => {
    expect(computeMaxAllowedSeconds(100_000)).toBe(100_000);
  });

  it("zero remaining authorizes zero", () => {
    expect(computeMaxAllowedSeconds(0)).toBe(0);
  });

  it("never returns a negative value", () => {
    expect(computeMaxAllowedSeconds(-50)).toBe(0);
  });
});

describe("ScenarioSchema", () => {
  it("accepts a well-formed scenario", () => {
    const result = ScenarioSchema.safeParse({
      id: "1",
      slug: "busy-vp",
      name: "Busy VP of Sales",
      description: "desc",
      difficulty: "realistic",
      objective: "objective",
      prospect_role: "VP of Sales",
      prospect_company: "Northstar",
      persona: { name: "Jordan Blake", common_objections: ["no thanks"] },
      hidden_state: {},
      target_duration_seconds: 180,
      is_active: true,
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid difficulty", () => {
    const result = ScenarioSchema.safeParse({
      id: "1",
      slug: "x",
      name: "x",
      description: "x",
      difficulty: "impossible",
      objective: "x",
      prospect_role: "x",
      prospect_company: "x",
      persona: {},
      hidden_state: {},
      target_duration_seconds: 1,
      is_active: true,
    });
    expect(result.success).toBe(false);
  });
});

describe("FreeEntitlementSchema", () => {
  it("accepts a well-formed free-plan entitlement snapshot", () => {
    const result = FreeEntitlementSchema.safeParse({
      plan: "free",
      dailyLimitSeconds: 600,
      usedTodaySeconds: 123,
      remainingTodaySeconds: 477,
      canStartCall: true,
      resetsAt: "2026-01-02T00:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a plan other than 'free' — there is no paid tier", () => {
    const result = FreeEntitlementSchema.safeParse({
      plan: "pro",
      dailyLimitSeconds: 600,
      usedTodaySeconds: 0,
      remainingTodaySeconds: 600,
      canStartCall: true,
      resetsAt: "2026-01-02T00:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a snapshot missing required fields", () => {
    const result = FreeEntitlementSchema.safeParse({ dailyLimitSeconds: 600 });
    expect(result.success).toBe(false);
  });

  it("has no field for a credit balance", () => {
    const parsed = FreeEntitlementSchema.parse({
      plan: "free",
      dailyLimitSeconds: 600,
      usedTodaySeconds: 0,
      remainingTodaySeconds: 600,
      canStartCall: true,
      resetsAt: "2026-01-02T00:00:00.000Z",
      // A caller might try to smuggle a credit balance through — it must be
      // silently stripped by the schema, not carried into the parsed shape.
      paidCreditsRemaining: 999,
    });
    expect("paidCreditsRemaining" in parsed).toBe(false);
  });
});

describe("CallAuthorizationSchema", () => {
  it("accepts a well-formed authorization", () => {
    const result = CallAuthorizationSchema.safeParse({
      sessionId: "session-1",
      scenarioId: "scenario-1",
      state: "authorized",
      maxAllowedSeconds: 480,
      gatewayUrl: "http://localhost:8787",
      token: "signed.jwt.token",
      remainingTodaySeconds: 480,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a state other than 'authorized'", () => {
    const result = CallAuthorizationSchema.safeParse({
      sessionId: "session-1",
      scenarioId: "scenario-1",
      state: "active",
      maxAllowedSeconds: 480,
      gatewayUrl: "http://localhost:8787",
      token: "signed.jwt.token",
      remainingTodaySeconds: 480,
    });
    expect(result.success).toBe(false);
  });
});

describe("VoiceSessionTokenClaimsSchema", () => {
  it("accepts a well-formed claim set", () => {
    const result = VoiceSessionTokenClaimsSchema.safeParse({
      sub: "user-1",
      sessionId: "session-1",
      scenarioId: "scenario-1",
      maxAllowedSeconds: 780,
      iat: 1_700_000_000,
      exp: 1_700_000_180,
      jti: "token-1",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a non-positive maxAllowedSeconds (the claim a client can't be allowed to widen)", () => {
    const result = VoiceSessionTokenClaimsSchema.safeParse({
      sub: "user-1",
      sessionId: "session-1",
      scenarioId: "scenario-1",
      maxAllowedSeconds: 0,
      iat: 1_700_000_000,
      exp: 1_700_000_180,
      jti: "token-1",
    });
    expect(result.success).toBe(false);
  });
});

describe("ClientToGatewayMessageSchema", () => {
  it("accepts audio/end/ping and nothing else", () => {
    expect(ClientToGatewayMessageSchema.safeParse({ type: "audio", data: "Zm9v" }).success).toBe(true);
    expect(ClientToGatewayMessageSchema.safeParse({ type: "end" }).success).toBe(true);
    expect(ClientToGatewayMessageSchema.safeParse({ type: "ping" }).success).toBe(true);
    expect(ClientToGatewayMessageSchema.safeParse({ type: "finalize", durationSeconds: 999 }).success).toBe(
      false,
    );
  });

  it("has no field for a client to submit a billable duration", () => {
    const parsed = ClientToGatewayMessageSchema.parse({ type: "end", durationSeconds: 999_999 });
    expect(parsed).toEqual({ type: "end" });
    expect("durationSeconds" in parsed).toBe(false);
  });

  it("rejects an empty audio chunk", () => {
    expect(ClientToGatewayMessageSchema.safeParse({ type: "audio", data: "" }).success).toBe(false);
  });

  it("rejects an oversized audio chunk (bounded well above one realistic real-time chunk)", () => {
    const oversized = "a".repeat(MAX_AUDIO_CHUNK_BASE64_CHARS + 1);
    expect(ClientToGatewayMessageSchema.safeParse({ type: "audio", data: oversized }).success).toBe(false);
  });

  it("accepts an audio chunk right at the bound", () => {
    const atBound = "a".repeat(MAX_AUDIO_CHUNK_BASE64_CHARS);
    expect(ClientToGatewayMessageSchema.safeParse({ type: "audio", data: atBound }).success).toBe(true);
  });
});

describe("GatewayToClientEventSchema", () => {
  it("accepts a completed event with nonnegative usage and no credit field", () => {
    const result = GatewayToClientEventSchema.safeParse({
      type: "completed",
      sessionId: "session-1",
      durationSeconds: 42,
      freeSecondsUsed: 42,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a negative remainingSeconds on a quota event", () => {
    const result = GatewayToClientEventSchema.safeParse({ type: "quota", remainingSeconds: -1 });
    expect(result.success).toBe(false);
  });

  it("accepts native provider audio output", () => {
    expect(GatewayToClientEventSchema.safeParse({ type: "audio", data: "YWJjZA==" }).success).toBe(true);
  });

  it("accepts an interruption (barge-in) event with no extra fields", () => {
    expect(GatewayToClientEventSchema.safeParse({ type: "interrupted" }).success).toBe(true);
  });

  it("accepts user and prospect transcript events", () => {
    expect(
      GatewayToClientEventSchema.safeParse({ type: "transcript", role: "user", text: "hi", final: true })
        .success,
    ).toBe(true);
    expect(
      GatewayToClientEventSchema.safeParse({ type: "transcript", role: "prospect", text: "hi", final: false })
        .success,
    ).toBe(true);
  });

  it("rejects a transcript role other than user/prospect", () => {
    const result = GatewayToClientEventSchema.safeParse({
      type: "transcript",
      role: "assistant",
      text: "hi",
      final: true,
    });
    expect(result.success).toBe(false);
  });
});

describe("Gemini configuration constants", () => {
  it("defaults to gemini-3.8-live", () => {
    expect(DEFAULT_GEMINI_MODEL).toBe("gemini-3.8-live");
  });

  it("uses Gemini Live's fixed native audio sample rates", () => {
    expect(GEMINI_INPUT_SAMPLE_RATE_HZ).toBe(16000);
    expect(GEMINI_OUTPUT_SAMPLE_RATE_HZ).toBe(24000);
  });
});
