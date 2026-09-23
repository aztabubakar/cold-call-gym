import { describe, it, expect } from "vitest";
import { classifyGeminiError } from "./gemini-error.js";

describe("classifyGeminiError", () => {
  it("classifies auth failures", () => {
    expect(classifyGeminiError(new Error("401 Unauthenticated")).code).toBe("provider_auth_error");
    expect(classifyGeminiError(new Error("PERMISSION_DENIED: invalid API key")).code).toBe("provider_auth_error");
    expect(classifyGeminiError("API key not valid").code).toBe("provider_auth_error");
  });

  it("classifies quota/rate-limit failures", () => {
    expect(classifyGeminiError(new Error("429 Too Many Requests")).code).toBe("provider_quota_error");
    expect(classifyGeminiError(new Error("RESOURCE_EXHAUSTED")).code).toBe("provider_quota_error");
  });

  it("classifies timeouts", () => {
    expect(classifyGeminiError(new Error("connection timed out")).code).toBe("provider_timeout");
  });

  it("classifies protocol errors", () => {
    expect(classifyGeminiError(new Error("INVALID_ARGUMENT: bad config")).code).toBe("provider_protocol_error");
    expect(classifyGeminiError({ code: 1007 }).code).toBe("provider_protocol_error");
  });

  it("classifies network/connection failures", () => {
    expect(classifyGeminiError(new Error("ECONNREFUSED")).code).toBe("provider_connection_error");
    expect(classifyGeminiError({ code: 1006, reason: "closed abnormally" }).code).toBe("provider_connection_error");
  });

  it("falls back to provider_unavailable for unrecognized failures", () => {
    expect(classifyGeminiError(new Error("something strange happened")).code).toBe("provider_unavailable");
    expect(classifyGeminiError(undefined).code).toBe("provider_unavailable");
  });

  it("never includes the raw input verbatim in a way that could leak secrets", () => {
    const result = classifyGeminiError(new Error("Authorization: Bearer sk-should-not-appear"));
    expect(result.message).not.toContain("sk-should-not-appear");
  });
});
