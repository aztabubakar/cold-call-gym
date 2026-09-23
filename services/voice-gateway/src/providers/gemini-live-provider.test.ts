import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { VoiceEvent } from "./voice-provider.js";

const connectMock = vi.fn();
const sendRealtimeInputMock = vi.fn();
const sessionCloseMock = vi.fn();

vi.mock("@google/genai", () => {
  return {
    GoogleGenAI: vi.fn().mockImplementation(() => ({
      live: { connect: connectMock },
    })),
    Modality: { AUDIO: "AUDIO", TEXT: "TEXT", VIDEO: "VIDEO" },
  };
});

const { GeminiLiveProvider } = await import("./gemini-live-provider.js");

type Callbacks = {
  onmessage: (message: unknown) => void;
  onerror: (e: unknown) => void;
  onclose: (e: unknown) => void;
};

function lastConnectCallbacks(): Callbacks {
  const call = connectMock.mock.calls.at(-1);
  if (!call) throw new Error("ai.live.connect was never called");
  return (call[0] as { callbacks: Callbacks }).callbacks;
}

describe("GeminiLiveProvider", () => {
  beforeEach(() => {
    connectMock.mockReset();
    sendRealtimeInputMock.mockReset();
    sessionCloseMock.mockReset();
    process.env.GEMINI_API_KEY = "test-api-key";
    delete process.env.GEMINI_MODEL;
    connectMock.mockImplementation(async () => ({
      sendRealtimeInput: sendRealtimeInputMock,
      close: sessionCloseMock,
    }));
  });

  afterEach(() => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_MODEL;
    vi.useRealTimers();
  });

  it("emits provider_auth_error and never calls the SDK when GEMINI_API_KEY is missing", async () => {
    delete process.env.GEMINI_API_KEY;
    const provider = new GeminiLiveProvider();
    const events: VoiceEvent[] = [];
    provider.onEvent((e) => events.push(e));

    await provider.connect({ systemPrompt: "test" });

    expect(connectMock).not.toHaveBeenCalled();
    expect(events).toEqual([
      { type: "error", code: "provider_auth_error", message: "GEMINI_API_KEY is not configured." },
    ]);
  });

  it("uses DEFAULT_GEMINI_MODEL when GEMINI_MODEL is unset, and configures AUDIO-only responses with no thinking/affective config", async () => {
    const provider = new GeminiLiveProvider();
    provider.onEvent(() => {});
    await provider.connect({ systemPrompt: "You are a prospect." });

    expect(connectMock).toHaveBeenCalledTimes(1);
    const params = connectMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(params.model).toBe("gemini-3.8-live");
    const config = params.config as Record<string, unknown>;
    expect(config.responseModalities).toEqual(["AUDIO"]);
    expect(config.systemInstruction).toBe("You are a prospect.");
    expect(config).not.toHaveProperty("thinkingConfig");
    expect(config).not.toHaveProperty("enableAffectiveDialog");
    expect(config).not.toHaveProperty("explicitVadSignal");
  });

  it("respects GEMINI_MODEL override", async () => {
    process.env.GEMINI_MODEL = "gemini-custom-live";
    const provider = new GeminiLiveProvider();
    provider.onEvent(() => {});
    await provider.connect({ systemPrompt: "test" });

    expect((connectMock.mock.calls[0]![0] as { model: string }).model).toBe("gemini-custom-live");
  });

  it("does not emit `connected` merely because the SDK connect() resolved", async () => {
    const provider = new GeminiLiveProvider();
    const events: VoiceEvent[] = [];
    provider.onEvent((e) => events.push(e));

    await provider.connect({ systemPrompt: "test" });

    expect(events).toEqual([]);
  });

  it("emits `connected` only after setupComplete arrives", async () => {
    const provider = new GeminiLiveProvider();
    const events: VoiceEvent[] = [];
    provider.onEvent((e) => events.push(e));
    await provider.connect({ systemPrompt: "test" });

    lastConnectCallbacks().onmessage({ setupComplete: { sessionId: "s1" } });

    expect(events).toEqual([{ type: "connected" }]);
  });

  it("times out and emits provider_timeout if setupComplete never arrives, closing the raw session", async () => {
    vi.useFakeTimers();
    const provider = new GeminiLiveProvider();
    const events: VoiceEvent[] = [];
    provider.onEvent((e) => events.push(e));
    await provider.connect({ systemPrompt: "test" });

    await vi.advanceTimersByTimeAsync(10_000);

    expect(events).toEqual([
      { type: "error", code: "provider_timeout", message: "Gemini Live did not become ready in time." },
    ]);
    expect(sessionCloseMock).toHaveBeenCalledTimes(1);
  });

  it("forwards audio, interrupted, and transcript events once ready", async () => {
    const provider = new GeminiLiveProvider();
    const events: VoiceEvent[] = [];
    provider.onEvent((e) => events.push(e));
    await provider.connect({ systemPrompt: "test" });
    const callbacks = lastConnectCallbacks();
    callbacks.onmessage({ setupComplete: {} });

    callbacks.onmessage({ data: "YWJjZA==", serverContent: {} });
    callbacks.onmessage({ serverContent: { interrupted: true } });
    callbacks.onmessage({ serverContent: { interimInputTranscription: { text: "hi the" } } });
    callbacks.onmessage({ serverContent: { inputTranscription: { text: "hi there" } } });
    callbacks.onmessage({ serverContent: { outputTranscription: { text: "Hello?" }, turnComplete: true } });

    expect(events).toEqual([
      { type: "connected" },
      { type: "audio", data: "YWJjZA==" },
      { type: "interrupted" },
      { type: "transcript", role: "user", text: "hi the", final: false },
      { type: "transcript", role: "user", text: "hi there", final: true },
      { type: "transcript", role: "prospect", text: "Hello?", final: true },
    ]);
  });

  it("sendAudio forwards to session.sendRealtimeInput with the 16kHz PCM mimeType", async () => {
    const provider = new GeminiLiveProvider();
    provider.onEvent(() => {});
    await provider.connect({ systemPrompt: "test" });
    lastConnectCallbacks().onmessage({ setupComplete: {} });

    await provider.sendAudio("YWJjZA==");

    expect(sendRealtimeInputMock).toHaveBeenCalledWith({
      audio: { data: "YWJjZA==", mimeType: "audio/pcm;rate=16000" },
    });
  });

  it("sendAudio before any connection is a safe no-op", async () => {
    const provider = new GeminiLiveProvider();
    await expect(provider.sendAudio("YWJjZA==")).resolves.toBeUndefined();
    expect(sendRealtimeInputMock).not.toHaveBeenCalled();
  });

  it("classifies a pre-ready onerror/onclose exactly once, even if both fire", async () => {
    const provider = new GeminiLiveProvider();
    const events: VoiceEvent[] = [];
    provider.onEvent((e) => events.push(e));
    await provider.connect({ systemPrompt: "test" });
    const callbacks = lastConnectCallbacks();

    callbacks.onerror(new Error("401 Unauthenticated"));
    callbacks.onclose({ code: 1006, reason: "abnormal" });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "error", code: "provider_auth_error" });
  });

  it("reports a classified error (not a bare closed event) when the connection drops after becoming ready", async () => {
    const provider = new GeminiLiveProvider();
    const events: VoiceEvent[] = [];
    provider.onEvent((e) => events.push(e));
    await provider.connect({ systemPrompt: "test" });
    const callbacks = lastConnectCallbacks();
    callbacks.onmessage({ setupComplete: {} });

    callbacks.onerror(new Error("RESOURCE_EXHAUSTED"));

    expect(events.at(-1)).toMatchObject({ type: "error", code: "provider_quota_error" });
  });

  it("close() is safe even if connect() was never called, and emits closed", async () => {
    const provider = new GeminiLiveProvider();
    const events: VoiceEvent[] = [];
    provider.onEvent((e) => events.push(e));

    await expect(provider.close()).resolves.toBeUndefined();
    expect(events).toEqual([{ type: "closed" }]);
  });

  it("close() closes the raw Gemini session once connected", async () => {
    const provider = new GeminiLiveProvider();
    provider.onEvent(() => {});
    await provider.connect({ systemPrompt: "test" });
    lastConnectCallbacks().onmessage({ setupComplete: {} });

    await provider.close();

    expect(sessionCloseMock).toHaveBeenCalledTimes(1);
  });
});
