import type { VoiceProviderErrorCode } from "../providers/voice-provider.js";

/**
 * Classifies a Gemini Live failure (a raw Error, WebSocket ErrorEvent,
 * CloseEvent, or close code) into the safe internal error taxonomy used
 * everywhere else in the gateway. This is a best-effort heuristic over
 * whatever text/close-code Gemini gives us — it never inspects or forwards
 * anything that could contain the API key or an Authorization header (the
 * SDK manages auth internally; these are just generic error/close signals).
 *
 * Pure and synchronous so it's directly unit-testable without a live
 * Gemini connection — see gemini-error.test.ts.
 */
export function classifyGeminiError(input: unknown): { code: VoiceProviderErrorCode; message: string } {
  const text = extractText(input).toLowerCase();

  if (/\b(401|403|unauthenticated|permission_denied|invalid api key|api key not valid)\b/.test(text)) {
    return { code: "provider_auth_error", message: "Gemini Live rejected the API credentials." };
  }

  if (/\b(429|resource_exhausted|quota|rate limit)\b/.test(text)) {
    return { code: "provider_quota_error", message: "Gemini Live quota or rate limit was exceeded." };
  }

  if (/\btimed?.?out\b/.test(text)) {
    return { code: "provider_timeout", message: "Gemini Live did not respond in time." };
  }

  if (/\b(1002|1003|1007|invalid_argument|protocol)\b/.test(text)) {
    return { code: "provider_protocol_error", message: "Gemini Live rejected the session configuration." };
  }

  if (/\b(econnrefused|enotfound|network|1006|closed abnormally)\b/.test(text)) {
    return { code: "provider_connection_error", message: "Could not reach Gemini Live." };
  }

  return { code: "provider_unavailable", message: "Gemini Live is currently unavailable." };
}

function extractText(input: unknown): string {
  if (input instanceof Error) return input.message;
  if (typeof input === "string") return input;
  if (input && typeof input === "object") {
    const obj = input as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof obj.message === "string") parts.push(obj.message);
    if (typeof obj.reason === "string") parts.push(obj.reason);
    if (typeof obj.code === "number" || typeof obj.code === "string") parts.push(String(obj.code));
    if (typeof obj.error === "string") parts.push(obj.error);
    if (parts.length > 0) return parts.join(" ");
  }
  return String(input);
}
