/**
 * Internal error taxonomy for provider failures. Mapped 1:1 onto the
 * client-facing GatewayToClientEvent's error `code` field (see
 * session-runtime.ts) — never the provider's raw error text, which may
 * contain implementation details that shouldn't reach the browser.
 */
export type VoiceProviderErrorCode =
  | "provider_auth_error"
  | "provider_quota_error"
  | "provider_connection_error"
  | "provider_timeout"
  | "provider_protocol_error"
  | "provider_unavailable";

export type VoiceEvent =
  | { type: "connected" }
  | { type: "text"; text: string }
  | { type: "audio"; data: string }
  | { type: "interrupted" }
  | { type: "transcript"; role: "user" | "prospect"; text: string; final: boolean }
  | { type: "error"; code: VoiceProviderErrorCode; message: string }
  | { type: "closed" };

export interface VoiceProvider {
  connect(context: { systemPrompt: string }): Promise<void>;
  sendAudio(base64: string): Promise<void>;
  onEvent(handler: (event: VoiceEvent) => void): void;
  close(): Promise<void>;
}
