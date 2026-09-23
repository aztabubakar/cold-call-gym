import { describe, it, expect } from "vitest";
import { validateGatewayConfig } from "./config.js";

describe("validateGatewayConfig", () => {
  it("passes when VOICE_PROVIDER is mock, regardless of GEMINI_API_KEY", () => {
    expect(validateGatewayConfig({ VOICE_PROVIDER: "mock" })).toEqual({ ok: true });
    expect(validateGatewayConfig({})).toEqual({ ok: true });
  });

  it("passes when VOICE_PROVIDER is gemini and GEMINI_API_KEY is set", () => {
    expect(validateGatewayConfig({ VOICE_PROVIDER: "gemini", GEMINI_API_KEY: "test-key" })).toEqual({ ok: true });
  });

  it("fails clearly when VOICE_PROVIDER is gemini but GEMINI_API_KEY is missing", () => {
    const result = validateGatewayConfig({ VOICE_PROVIDER: "gemini" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("GEMINI_API_KEY");
      expect(result.message).toContain("VOICE_PROVIDER=gemini");
    }
  });

  it("fails when GEMINI_API_KEY is an empty string", () => {
    const result = validateGatewayConfig({ VOICE_PROVIDER: "gemini", GEMINI_API_KEY: "" });
    expect(result.ok).toBe(false);
  });
});
