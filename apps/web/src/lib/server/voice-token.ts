import "server-only";
import { SignJWT } from "jose";
import { randomUUID } from "node:crypto";
import { VOICE_TOKEN_TTL_SECONDS, type VoiceSessionTokenClaims } from "@cold-call-gym/shared";

function getSigningSecret(): Uint8Array {
  const secret = process.env.VOICE_GATEWAY_SIGNING_SECRET;
  if (!secret) {
    throw new Error("VOICE_GATEWAY_SIGNING_SECRET is not configured");
  }
  return new TextEncoder().encode(secret);
}

/**
 * Signs a short-lived (VOICE_TOKEN_TTL_SECONDS) JWT that authorizes the
 * browser to open exactly one voice-gateway WebSocket connection for one
 * call_sessions row. This token only proves "the web server just authorized
 * this call for this user" — it does NOT grant spending on its own. The
 * gateway still re-validates the session's live database state before
 * starting its timer, and the same atomic finalize_call_usage() RPC used
 * since Phase 2 remains the only path that ever records billable usage
 * against the free daily allowance (Cold Call Gym has no paid credits).
 *
 * maxAllowedSeconds is a signed claim, not a value the browser can supply or
 * alter — tampering with it invalidates the signature (see
 * services/voice-gateway/src/lib/token.ts for verification).
 */
export async function signVoiceSessionToken(claims: {
  userId: string;
  sessionId: string;
  scenarioId: string;
  maxAllowedSeconds: number;
}): Promise<{ token: string; expiresAt: number }> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + VOICE_TOKEN_TTL_SECONDS;

  const token = await new SignJWT({
    sessionId: claims.sessionId,
    scenarioId: claims.scenarioId,
    maxAllowedSeconds: claims.maxAllowedSeconds,
  } satisfies Omit<VoiceSessionTokenClaims, "sub" | "iat" | "exp" | "jti">)
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.userId)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .setJti(randomUUID())
    .sign(getSigningSecret());

  return { token, expiresAt: exp };
}
