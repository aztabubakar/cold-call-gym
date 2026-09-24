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
 * call session. This token only proves "the web server just authorized
 * this call for this access identity" — the gateway still re-validates the
 * session's live state (via the internal sessions API) before relaying any
 * audio. Calls are free and unlimited (see docs/MONETIZATION.md), so this
 * grants nothing beyond "this session may connect."
 *
 * The `sub` claim is the lead's opaque accessId (see
 * lib/server/access.ts) — never their name, email, or phone. Cold Call
 * Gym has no accounts, so there is no "user id" here in the authentication
 * sense; this identifies which access session the call belongs to.
 */
export async function signVoiceSessionToken(claims: {
  accessId: string;
  sessionId: string;
  scenarioId: string;
}): Promise<{ token: string; expiresAt: number }> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + VOICE_TOKEN_TTL_SECONDS;

  const token = await new SignJWT({
    sessionId: claims.sessionId,
    scenarioId: claims.scenarioId,
  } satisfies Omit<VoiceSessionTokenClaims, "sub" | "iat" | "exp" | "jti">)
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.accessId)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .setJti(randomUUID())
    .sign(getSigningSecret());

  return { token, expiresAt: exp };
}
