import { z } from "zod";

export const DifficultySchema = z.enum(["practice","realistic","challenge"]);
export const CallStateSchema = z.enum(["created","authorized","connecting","active","ending","completed","failed"]);

export type Difficulty = z.infer<typeof DifficultySchema>;
export type CallState = z.infer<typeof CallStateSchema>;

export const CoachingReportSchema = z.object({
  overallSummary: z.string(),
  categories: z.array(z.object({
    name: z.string(),
    score: z.number().min(0).max(100),
    evidence: z.array(z.string()),
    feedback: z.string(),
  })),
  strengths: z.array(z.string()),
  improvements: z.array(z.string()),
  nextDrill: z.string(),
});

export const ScenarioPersonaSchema = z.object({
  name: z.string().optional(),
  patience: z.string().optional(),
  skepticism: z.string().optional(),
  current_solution: z.string().optional(),
  common_objections: z.array(z.string()).optional(),
}).catchall(z.unknown());

export const ScenarioSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  difficulty: DifficultySchema,
  objective: z.string(),
  prospect_role: z.string(),
  prospect_company: z.string(),
  persona: ScenarioPersonaSchema,
  hidden_state: z.record(z.string(), z.unknown()),
  target_duration_seconds: z.number(),
  is_active: z.boolean(),
});

export type Scenario = z.infer<typeof ScenarioSchema>;

export const DAILY_FREE_SECONDS = 600;

// A paid credit covers up to 60 seconds; any started 60-second block costs
// one credit (1s..60s = 1 credit, 61s = 2 credits, etc).
export const SECONDS_PER_CREDIT = 60;

// Hard ceiling on a single call's authorized duration, independent of how
// much entitlement a user has (mirrors services/voice-gateway's
// MAX_CALL_SECONDS default).
export const MAX_CALL_SECONDS = 1800;

// One-time promotional credits granted to every new user at signup.
export const WELCOME_CREDITS = 5;

export function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export const EntitlementSchema = z.object({
  freeDailySeconds: z.number(),
  freeSecondsUsedToday: z.number(),
  freeSecondsRemaining: z.number(),
  paidCreditsRemaining: z.number(),
  paidSecondsAvailable: z.number(),
  totalUsableSeconds: z.number(),
});

export type Entitlement = z.infer<typeof EntitlementSchema>;

export const CallAuthorizationSchema = z.object({
  sessionId: z.string(),
  scenarioId: z.string(),
  state: z.literal("authorized"),
  maxAllowedSeconds: z.number(),
  gatewayUrl: z.string(),
  token: z.string(),
  freeSecondsRemaining: z.number(),
  paidCreditsRemaining: z.number(),
});

export type CallAuthorization = z.infer<typeof CallAuthorizationSchema>;

// ---------------------------------------------------------------------------
// Phase 3: signed voice-gateway token claims.
//
// Issued by POST /api/voice/session (apps/web), verified by the voice
// gateway (services/voice-gateway) using the same shared secret
// (VOICE_GATEWAY_SIGNING_SECRET). Short-lived (see VOICE_TOKEN_TTL_SECONDS)
// and scoped to exactly one call_sessions row — it authorizes *connecting*,
// not spending; the gateway still verifies the session's live DB state
// before starting a timer, and all billing runs through the same atomic
// finalize_call_usage() RPC used since Phase 2. maxAllowedSeconds is signed
// alongside sub/sessionId so the browser can never widen its own quota: an
// altered claim invalidates the signature.
// ---------------------------------------------------------------------------

export const VOICE_TOKEN_TTL_SECONDS = 180;

export const VoiceSessionTokenClaimsSchema = z.object({
  sub: z.string(), // user id
  sessionId: z.string(),
  scenarioId: z.string(),
  maxAllowedSeconds: z.number().int().positive(),
  iat: z.number().int(),
  exp: z.number().int(),
  jti: z.string(),
});

export type VoiceSessionTokenClaims = z.infer<typeof VoiceSessionTokenClaimsSchema>;

// ---------------------------------------------------------------------------
// Phase 3: WebSocket event contract between the browser and the voice
// gateway. Kept separate from services/voice-gateway's internal
// VoiceProvider events (connected/text/audio/error/closed), which describe
// the mock/Gemini provider's own lifecycle — the gateway translates those
// into this richer, session-aware contract.
// ---------------------------------------------------------------------------

export const ClientToGatewayMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("audio"), data: z.string() }),
  z.object({ type: z.literal("end") }),
  z.object({ type: z.literal("ping") }),
]);

export type ClientToGatewayMessage = z.infer<typeof ClientToGatewayMessageSchema>;

export const GatewayToClientEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("connected") }),
  z.object({ type: z.literal("active"), sessionId: z.string(), maxAllowedSeconds: z.number() }),
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("quota"), remainingSeconds: z.number().min(0) }),
  z.object({ type: z.literal("quota_exhausted") }),
  z.object({
    type: z.literal("completed"),
    sessionId: z.string(),
    durationSeconds: z.number().min(0),
    freeSecondsUsed: z.number().min(0),
    paidCreditsUsed: z.number().min(0),
  }),
  z.object({ type: z.literal("error"), code: z.string(), message: z.string() }),
  z.object({ type: z.literal("closed") }),
  z.object({ type: z.literal("pong") }),
]);

export type GatewayToClientEvent = z.infer<typeof GatewayToClientEventSchema>;
