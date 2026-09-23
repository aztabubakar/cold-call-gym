import { describe, it, expect } from "vitest";
import {
  formatDuration,
  DAILY_FREE_SECONDS,
  SECONDS_PER_CREDIT,
  MAX_CALL_SECONDS,
  WELCOME_CREDITS,
  ScenarioSchema,
  EntitlementSchema,
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

describe("entitlement constants", () => {
  it("1 credit = 60 seconds", () => expect(SECONDS_PER_CREDIT).toBe(60));
  it("MAX_CALL_SECONDS matches the voice-gateway default ceiling", () =>
    expect(MAX_CALL_SECONDS).toBe(1800));
  it("welcome grant is 5 credits", () => expect(WELCOME_CREDITS).toBe(5));
});

describe("EntitlementSchema", () => {
  it("accepts a well-formed entitlement snapshot", () => {
    const result = EntitlementSchema.safeParse({
      freeDailySeconds: 600,
      freeSecondsUsedToday: 240,
      freeSecondsRemaining: 360,
      paidCreditsRemaining: 12,
      paidSecondsAvailable: 720,
      totalUsableSeconds: 1080,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a snapshot missing required fields", () => {
    const result = EntitlementSchema.safeParse({ freeDailySeconds: 600 });
    expect(result.success).toBe(false);
  });
});

describe("CallAuthorizationSchema", () => {
  it("accepts a well-formed authorization", () => {
    const result = CallAuthorizationSchema.safeParse({
      sessionId: "session-1",
      scenarioId: "scenario-1",
      state: "authorized",
      maxAllowedSeconds: 780,
      gatewayUrl: "http://localhost:8787",
      token: "signed.jwt.token",
      freeSecondsRemaining: 480,
      paidCreditsRemaining: 5,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a state other than 'authorized'", () => {
    const result = CallAuthorizationSchema.safeParse({
      sessionId: "session-1",
      scenarioId: "scenario-1",
      state: "active",
      maxAllowedSeconds: 780,
      gatewayUrl: "http://localhost:8787",
      token: "signed.jwt.token",
      freeSecondsRemaining: 480,
      paidCreditsRemaining: 5,
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
});

describe("GatewayToClientEventSchema", () => {
  it("accepts a completed event with nonnegative usage", () => {
    const result = GatewayToClientEventSchema.safeParse({
      type: "completed",
      sessionId: "session-1",
      durationSeconds: 42,
      freeSecondsUsed: 42,
      paidCreditsUsed: 0,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a negative remainingSeconds on a quota event", () => {
    const result = GatewayToClientEventSchema.safeParse({ type: "quota", remainingSeconds: -1 });
    expect(result.success).toBe(false);
  });
});
