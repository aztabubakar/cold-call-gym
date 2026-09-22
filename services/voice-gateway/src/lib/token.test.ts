import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SignJWT } from "jose";
import { verifyVoiceSessionToken } from "./token.js";

const SECRET = "test-signing-secret-please-ignore";

async function sign(
  claimsOverrides: Record<string, unknown> = {},
  opts: { secret?: string; expiresInSec?: number; subject?: string } = {},
) {
  const now = Math.floor(Date.now() / 1000);
  const key = new TextEncoder().encode(opts.secret ?? SECRET);
  return new SignJWT({
    sessionId: "session-1",
    scenarioId: "scenario-1",
    maxAllowedSeconds: 120,
    ...claimsOverrides,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(opts.subject ?? "user-1")
    .setIssuedAt(now)
    .setExpirationTime(now + (opts.expiresInSec ?? 180))
    .setJti("jti-1")
    .sign(key);
}

describe("verifyVoiceSessionToken", () => {
  beforeEach(() => {
    process.env.VOICE_GATEWAY_SIGNING_SECRET = SECRET;
  });
  afterEach(() => {
    delete process.env.VOICE_GATEWAY_SIGNING_SECRET;
  });

  it("accepts a validly signed, unexpired token", async () => {
    const token = await sign();
    const result = await verifyVoiceSessionToken(token);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.claims.sub).toBe("user-1");
      expect(result.claims.sessionId).toBe("session-1");
      expect(result.claims.maxAllowedSeconds).toBe(120);
    }
  });

  it("rejects a missing token", async () => {
    const result = await verifyVoiceSessionToken(undefined);
    expect(result).toEqual({ ok: false, code: "missing_token" });
  });

  it("rejects an expired token", async () => {
    const token = await sign({}, { expiresInSec: -1 });
    const result = await verifyVoiceSessionToken(token);
    expect(result).toEqual({ ok: false, code: "expired_token" });
  });

  it("rejects a token signed with the wrong secret", async () => {
    const token = await sign({}, { secret: "a-completely-different-secret" });
    const result = await verifyVoiceSessionToken(token);
    expect(result).toEqual({ ok: false, code: "invalid_token" });
  });

  it("rejects a tampered token — altered maxAllowedSeconds invalidates the signature", async () => {
    const token = await sign();
    const [header, payload, signature] = token.split(".");
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString());
    const tamperedPayload = Buffer.from(
      JSON.stringify({ ...decoded, maxAllowedSeconds: 999_999 }),
    ).toString("base64url");
    const tampered = `${header}.${tamperedPayload}.${signature}`;

    const result = await verifyVoiceSessionToken(tampered);
    expect(result).toEqual({ ok: false, code: "invalid_token" });
  });

  it("rejects a malformed / non-JWT token", async () => {
    const result = await verifyVoiceSessionToken("not-a-jwt");
    expect(result).toEqual({ ok: false, code: "invalid_token" });
  });

  it("rejects a structurally valid JWT that is missing required claims", async () => {
    const now = Math.floor(Date.now() / 1000);
    const key = new TextEncoder().encode(SECRET);
    const token = await new SignJWT({ foo: "bar" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(now)
      .setExpirationTime(now + 180)
      .sign(key);

    const result = await verifyVoiceSessionToken(token);
    expect(result).toEqual({ ok: false, code: "malformed_claims" });
  });

  it("rejects any token when no signing secret is configured", async () => {
    const token = await sign();
    delete process.env.VOICE_GATEWAY_SIGNING_SECRET;
    const result = await verifyVoiceSessionToken(token);
    expect(result.ok).toBe(false);
  });
});
