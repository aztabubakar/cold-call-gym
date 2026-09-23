/**
 * Startup configuration validation. Called once from index.ts before the
 * gateway starts accepting connections — fails fast and loudly rather than
 * accepting connections and only discovering a missing Gemini credential
 * on the first real call.
 *
 * Pure (reads only the env object passed in) so it's directly
 * unit-testable without mutating process.env — see config.test.ts.
 */
export type ConfigValidationResult = { ok: true } | { ok: false; message: string };

export function validateGatewayConfig(env: NodeJS.ProcessEnv): ConfigValidationResult {
  const provider = env.VOICE_PROVIDER ?? "mock";

  if (provider === "gemini" && !env.GEMINI_API_KEY) {
    return {
      ok: false,
      message:
        "VOICE_PROVIDER=gemini but GEMINI_API_KEY is not set. Set GEMINI_API_KEY (see .env.example) or " +
        "switch VOICE_PROVIDER=mock for local development.",
    };
  }

  return { ok: true };
}
