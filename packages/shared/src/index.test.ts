import { describe, it, expect } from "vitest";
import {
  formatDuration,
  DEFAULT_GEMINI_MODEL,
  GEMINI_INPUT_SAMPLE_RATE_HZ,
  GEMINI_OUTPUT_SAMPLE_RATE_HZ,
  MAX_AUDIO_CHUNK_BASE64_CHARS,
  ScenarioSchema,
  PracticeStatsSchema,
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

describe("PracticeStatsSchema", () => {
  it("accepts a well-formed practice-stats snapshot", () => {
    const result = PracticeStatsSchema.safeParse({ usedTodaySeconds: 123 });
    expect(result.success).toBe(true);
  });

  it("rejects a snapshot missing required fields", () => {
    const result = PracticeStatsSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("has no field for a credit balance or a daily cap — practice is free and unlimited", () => {
    const parsed = PracticeStatsSchema.parse({
      usedTodaySeconds: 0,
      // A caller might try to smuggle these through — they must be
      // silently stripped by the schema, not carried into the parsed shape.
      paidCreditsRemaining: 999,
      dailyLimitSeconds: 600,
    });
    expect("paidCreditsRemaining" in parsed).toBe(false);
    expect("dailyLimitSeconds" in parsed).toBe(false);
  });
});

describe("CallAuthorizationSchema", () => {
  it("accepts a well-formed authorization", () => {
    const result = CallAuthorizationSchema.safeParse({
      sessionId: "session-1",
      scenarioId: "scenario-1",
      state: "authorized",
      gatewayUrl: "http://localhost:8787",
      token: "signed.jwt.token",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a state other than 'authorized'", () => {
    const result = CallAuthorizationSchema.safeParse({
      sessionId: "session-1",
      scenarioId: "scenario-1",
      state: "active",
      gatewayUrl: "http://localhost:8787",
      token: "signed.jwt.token",
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
      iat: 1_700_000_000,
      exp: 1_700_000_180,
      jti: "token-1",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a claim set missing required fields", () => {
    const result = VoiceSessionTokenClaimsSchema.safeParse({
      sub: "user-1",
      sessionId: "session-1",
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
  it("accepts a completed event with nonnegative duration and no credit field", () => {
    const result = GatewayToClientEventSchema.safeParse({
      type: "completed",
      sessionId: "session-1",
      durationSeconds: 42,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a completed event with a negative duration", () => {
    const result = GatewayToClientEventSchema.safeParse({
      type: "completed",
      sessionId: "session-1",
      durationSeconds: -1,
    });
    expect(result.success).toBe(false);
  });

  it("has no quota/quota_exhausted event — calls are free and unlimited", () => {
    expect(GatewayToClientEventSchema.safeParse({ type: "quota", remainingSeconds: 10 }).success).toBe(false);
    expect(GatewayToClientEventSchema.safeParse({ type: "quota_exhausted" }).success).toBe(false);
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
