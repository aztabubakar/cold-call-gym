import { jwtVerify, errors as joseErrors } from "jose";
import { VoiceSessionTokenClaimsSchema, type VoiceSessionTokenClaims } from "@cold-call-gym/shared";

export type TokenVerificationResult =
  | { ok: true; claims: VoiceSessionTokenClaims }
  | { ok: false; code: "missing_token" | "invalid_token" | "expired_token" | "malformed_claims" };

function getSigningSecret(): Uint8Array | null {
  const secret = process.env.VOICE_GATEWAY_SIGNING_SECRET;
  if (!secret) return null;
  return new TextEncoder().encode(secret);
}

export function isTokenVerificationConfigured(): boolean {
  return Boolean(process.env.VOICE_GATEWAY_SIGNING_SECRET);
}

/**
 * Verifies a signed voice-session token issued by
 * apps/web/src/lib/server/voice-token.ts. Both sides share
 * VOICE_GATEWAY_SIGNING_SECRET — this is the only thing that makes the
 * gateway trust a claim like maxAllowedSeconds without re-deriving it
 * itself. Signature and expiration are checked by `jose`; claim shape is
 * checked against VoiceSessionTokenClaimsSchema so a structurally valid but
 * unexpected payload is rejected the same as a bad signature.
 */
export async function verifyVoiceSessionToken(token: string | undefined): Promise<TokenVerificationResult> {
  if (!token) return { ok: false, code: "missing_token" };

  const secret = getSigningSecret();
  if (!secret) return { ok: false, code: "invalid_token" };

  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"] });
    const parsed = VoiceSessionTokenClaimsSchema.safeParse(payload);
    if (!parsed.success) {
      return { ok: false, code: "malformed_claims" };
    }
    return { ok: true, claims: parsed.data };
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) {
      return { ok: false, code: "expired_token" };
    }
    // Signature mismatch, malformed compact JWT, wrong algorithm, etc. —
    // all treated as a generic invalid token. Never surface `err` itself to
    // the client (see index.ts), only this coarse code.
    return { ok: false, code: "invalid_token" };
  }
}
