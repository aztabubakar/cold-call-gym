import { GoogleGenAI, Modality, type LiveServerMessage, type Session } from "@google/genai";
import { DEFAULT_GEMINI_MODEL } from "@cold-call-gym/shared";
import type { VoiceEvent, VoiceProvider, VoiceProviderErrorCode } from "./voice-provider.js";
import { classifyGeminiError } from "../lib/gemini-error.js";

const READY_TIMEOUT_MS = 10_000;

/**
 * Real Gemini Live provider using the official @google/genai SDK.
 *
 * GEMINI_API_KEY is read here, in this Node process, and nowhere else —
 * never sent to the browser, never logged, never embedded in the signed
 * voice-session token (see docs/SECURITY.md). GEMINI_MODEL selects the
 * model (default DEFAULT_GEMINI_MODEL = "gemini-3.8-live").
 *
 * Readiness contract this provider upholds for session-runtime.ts's
 * billing guarantee: `connected` is emitted ONLY after Gemini's
 * `setupComplete` message arrives — never merely because the underlying
 * WebSocket to Gemini opened. That's what session-runtime.ts uses to
 * decide when to start the authoritative timer (becomeActive()). If
 * setupComplete never arrives within READY_TIMEOUT_MS, this is treated as
 * a pre-active failure (provider_timeout) — zero billable time.
 *
 * This provider never throws out of connect(): every outcome (ready or
 * failed) is signaled through the VoiceEvent handler, exactly like
 * MockVoiceProvider, so session-runtime's single control-flow path
 * (listen for `connected` vs `error` events) doesn't need a special case
 * per provider.
 */
export class GeminiLiveProvider implements VoiceProvider {
  private handler?: (e: VoiceEvent) => void;
  private session: Session | null = null;
  private ready = false;
  private settled = false; // true once we've emitted a terminal pre-active outcome (connected or error)
  private readyTimeout: ReturnType<typeof setTimeout> | null = null;

  onEvent(h: (e: VoiceEvent) => void): void {
    this.handler = h;
  }

  async connect(context: { systemPrompt: string }): Promise<void> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      this.failPreActive({ code: "provider_auth_error", message: "GEMINI_API_KEY is not configured." });
      return;
    }

    const model = process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
    const ai = new GoogleGenAI({ apiKey });

    this.readyTimeout = setTimeout(() => {
      if (this.settled) return;
      this.failPreActive({ code: "provider_timeout", message: "Gemini Live did not become ready in time." });
      this.closeRawSession();
    }, READY_TIMEOUT_MS);

    try {
      this.session = await ai.live.connect({
        model,
        config: {
          // Native audio-to-audio, per product requirement — never TEXT-only.
          responseModalities: [Modality.AUDIO],
          systemInstruction: context.systemPrompt,
          // Enabled for UI/debugging transcript display (see
          // packages/shared's `transcript` GatewayToClientEvent). Never a
          // requirement for the call itself to function.
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          // Deliberately NOT set for gemini-3.8-live, per product
          // requirement: no thinkingConfig (thinking models aren't what
          // this conversational voice persona needs) and no
          // enableAffectiveDialog (obsolete/unnecessary here). Also
          // deliberately not setting realtimeInputConfig/explicitVadSignal
          // — automatic voice-activity-based turn detection and barge-in
          // are the default behavior and exactly what a natural phone
          // conversation needs (see docs/ARCHITECTURE.md's "Turn
          // detection").
        },
        callbacks: {
          onmessage: (message) => this.handleMessage(message),
          onerror: (e) => this.handleTransportFailure(e),
          onclose: (e) => this.handleTransportFailure(e),
        },
      });
    } catch (err) {
      this.failPreActive(classifyGeminiError(err));
    }
  }

  private handleMessage(message: LiveServerMessage): void {
    if (this.settled === false && message.setupComplete) {
      this.markReady();
      return;
    }

    const content = message.serverContent;
    if (!content) return;

    if (content.interrupted) {
      this.handler?.({ type: "interrupted" });
    }

    const audioData = message.data;
    if (audioData) {
      this.handler?.({ type: "audio", data: audioData });
    }

    const interimUser = content.interimInputTranscription?.text;
    if (interimUser) {
      this.handler?.({ type: "transcript", role: "user", text: interimUser, final: false });
    }
    const finalUser = content.inputTranscription?.text;
    if (finalUser) {
      this.handler?.({ type: "transcript", role: "user", text: finalUser, final: true });
    }
    const prospectText = content.outputTranscription?.text;
    if (prospectText) {
      this.handler?.({ type: "transcript", role: "prospect", text: prospectText, final: Boolean(content.turnComplete) });
    }
  }

  private handleTransportFailure(e: unknown): void {
    const classified = classifyGeminiError(e);
    if (!this.ready) {
      this.failPreActive(classified);
      return;
    }
    // Already active: report the failure and let session-runtime's normal
    // active-phase error handling finalize whatever elapsed time is real.
    this.handler?.({ type: "error", ...classified });
  }

  private markReady(): void {
    if (this.readyTimeout) {
      clearTimeout(this.readyTimeout);
      this.readyTimeout = null;
    }
    this.ready = true;
    this.settled = true;
    this.handler?.({ type: "connected" });
  }

  private failPreActive(err: { code: VoiceProviderErrorCode; message: string }): void {
    if (this.settled) return;
    this.settled = true;
    if (this.readyTimeout) {
      clearTimeout(this.readyTimeout);
      this.readyTimeout = null;
    }
    this.handler?.({ type: "error", code: err.code, message: err.message });
  }

  async sendAudio(base64: string): Promise<void> {
    if (!this.session) return;
    try {
      this.session.sendRealtimeInput({ audio: { data: base64, mimeType: "audio/pcm;rate=16000" } });
    } catch (err) {
      // Fire-and-forget from session-runtime's perspective: a transient
      // send failure will typically also surface via onerror/onclose,
      // which drives the real failure path. Don't crash the call over one
      // dropped chunk.
      this.handler?.({ type: "error", ...classifyGeminiError(err) });
    }
  }

  async close(): Promise<void> {
    if (this.readyTimeout) {
      clearTimeout(this.readyTimeout);
      this.readyTimeout = null;
    }
    this.closeRawSession();
    this.handler?.({ type: "closed" });
  }

  private closeRawSession(): void {
    try {
      this.session?.close();
    } catch {
      // Never let a close-time failure propagate — the call is ending
      // either way.
    }
    this.session = null;
  }
}
