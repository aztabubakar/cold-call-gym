import { describe, it, expect, vi } from "vitest";
import { CallSessionRuntime, type CallSessionRuntimeDeps } from "./session-runtime.js";
import type { VoiceEvent, VoiceProvider } from "./providers/voice-provider.js";
import { FakeClock } from "./lib/clock.js";
import type { GatewayToClientEvent, VoiceSessionTokenClaims } from "@cold-call-gym/shared";
import type { CallSessionRecord } from "./lib/session-store.js";
import type { FinalizeUsageResult } from "./lib/entitlement.js";

class FakeProvider implements VoiceProvider {
  handler?: (e: VoiceEvent) => void;
  connectError: Error | null = null;
  sentAudio: string[] = [];
  closed = false;

  async connect(_context: { systemPrompt: string }): Promise<void> {
    if (this.connectError) throw this.connectError;
    // Deliberately does NOT auto-emit 'connected' — tests call emit()
    // explicitly so they can assert on the state in between.
  }
  async sendAudio(data: string): Promise<void> {
    this.sentAudio.push(data);
  }
  onEvent(handler: (e: VoiceEvent) => void): void {
    this.handler = handler;
  }
  async close(): Promise<void> {
    this.closed = true;
  }
  emit(event: VoiceEvent) {
    this.handler?.(event);
  }
}

function makeSession(overrides: Partial<CallSessionRecord> = {}): CallSessionRecord {
  return {
    id: "session-1",
    accessId: "access-1",
    scenarioId: "scenario-1",
    state: "authorized",
    usageFinalizedAt: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeClaims(overrides: Partial<VoiceSessionTokenClaims> = {}): VoiceSessionTokenClaims {
  return {
    sub: "access-1",
    sessionId: "session-1",
    scenarioId: "scenario-1",
    maxAllowedSeconds: 120,
    iat: 0,
    exp: 9_999_999_999,
    jti: "jti-1",
    ...overrides,
  };
}

function makeDeps(
  opts: { provider?: FakeProvider; maxCallSecondsCeiling?: number; quotaIntervalMs?: number } = {},
) {
  const provider = opts.provider ?? new FakeProvider();
  const clock = new FakeClock();
  const events: GatewayToClientEvent[] = [];
  const closeCalls: { code: number; reason: string }[] = [];
  const stateTransitions: string[] = [];
  const failedSessions: string[] = [];

  const finalizeCallUsage = vi.fn(
    async (params: { sessionId: string; durationSeconds: number; idempotencyKey: string }) => {
      const result: FinalizeUsageResult = {
        sessionId: params.sessionId,
        state: "completed",
        durationSeconds: params.durationSeconds,
        freeSecondsUsed: params.durationSeconds,
        alreadyFinalized: false,
      };
      return result;
    },
  );

  const deps: CallSessionRuntimeDeps = {
    clock,
    maxCallSecondsCeiling: opts.maxCallSecondsCeiling ?? 1800,
    quotaIntervalMs: opts.quotaIntervalMs ?? 15_000,
    log: { info: () => {}, warn: () => {}, error: () => {} },
    createProvider: () => provider,
    finalizeCallUsage,
    markCallSessionFailed: vi.fn(async (sessionId: string) => {
      failedSessions.push(sessionId);
    }),
    transitionCallSessionState: vi.fn(async (_sessionId: string, state: string) => {
      stateTransitions.push(state);
    }),
    send: (event) => events.push(event),
    closeSocket: (code, reason) => closeCalls.push({ code, reason }),
  };

  return { deps, provider, clock, events, closeCalls, stateTransitions, failedSessions, finalizeCallUsage };
}

async function connectAndActivate(runtime: CallSessionRuntime, provider: FakeProvider) {
  await runtime.start();
  provider.emit({ type: "connected" });
}

describe("CallSessionRuntime", () => {
  it("transitions authorized -> connecting -> active once the provider connects", async () => {
    const { deps, provider, events, stateTransitions } = makeDeps();
    const runtime = new CallSessionRuntime(makeSession(), makeClaims(), deps);

    await connectAndActivate(runtime, provider);

    expect(runtime.currentPhase).toBe("active");
    expect(stateTransitions).toEqual(["connecting", "active"]);
    expect(events.find((e) => e.type === "active")).toMatchObject({
      type: "active",
      sessionId: "session-1",
      maxAllowedSeconds: 120,
    });
  });

  it("pre-active provider failure marks the session failed and consumes zero usage", async () => {
    const provider = new FakeProvider();
    provider.connectError = new Error("provider unavailable");
    const { deps, failedSessions, finalizeCallUsage, closeCalls } = makeDeps({ provider });
    const runtime = new CallSessionRuntime(makeSession(), makeClaims(), deps);

    await runtime.start();

    expect(runtime.currentPhase).toBe("failed");
    expect(failedSessions).toEqual(["session-1"]);
    expect(finalizeCallUsage).not.toHaveBeenCalled();
    expect(closeCalls).toHaveLength(1);
  });

  it("marks failed (no finalize) if the socket closes before the provider ever connects", async () => {
    const provider = new FakeProvider(); // never emits 'connected'
    const { deps, finalizeCallUsage, failedSessions } = makeDeps({ provider });
    const runtime = new CallSessionRuntime(makeSession(), makeClaims(), deps);

    await runtime.start();
    await runtime.handleSocketClose();

    expect(failedSessions).toEqual(["session-1"]);
    expect(finalizeCallUsage).not.toHaveBeenCalled();
  });

  it("explicit end finalizes exactly once, using the gateway's own clock", async () => {
    const { deps, provider, clock, finalizeCallUsage, events } = makeDeps();
    const runtime = new CallSessionRuntime(makeSession(), makeClaims(), deps);
    await connectAndActivate(runtime, provider);

    clock.advanceMs(5_000);
    runtime.handleClientMessage(JSON.stringify({ type: "end" }));
    await vi.waitFor(() => expect(finalizeCallUsage).toHaveBeenCalledTimes(1));

    expect(finalizeCallUsage).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "session-1", durationSeconds: 5, idempotencyKey: "usage:session-1" }),
    );
    expect(events.find((e) => e.type === "completed")).toBeTruthy();

    // A second explicit end must not trigger a second finalize call.
    runtime.handleClientMessage(JSON.stringify({ type: "end" }));
    await Promise.resolve();
    expect(finalizeCallUsage).toHaveBeenCalledTimes(1);
  });

  it("ignores any duration the browser attempts to supply in the end message", async () => {
    const { deps, provider, clock, finalizeCallUsage } = makeDeps();
    const runtime = new CallSessionRuntime(makeSession(), makeClaims(), deps);
    await connectAndActivate(runtime, provider);

    clock.advanceMs(3_000);
    // A spoofed extra field on the wire message — the runtime's message
    // type has no `durationSeconds` field at all, so there is nothing for
    // a malicious client to inject here; this proves it's structurally
    // ignored, not just unused by convention.
    runtime.handleClientMessage(JSON.stringify({ type: "end", durationSeconds: 999_999 }));
    await vi.waitFor(() => expect(finalizeCallUsage).toHaveBeenCalled());

    expect(finalizeCallUsage).toHaveBeenCalledWith(expect.objectContaining({ durationSeconds: 3 }));
  });

  it("finalizes exactly once on abrupt disconnect while active", async () => {
    const { deps, provider, clock, finalizeCallUsage } = makeDeps();
    const runtime = new CallSessionRuntime(makeSession(), makeClaims(), deps);
    await connectAndActivate(runtime, provider);

    clock.advanceMs(4_200); // ceil(4200ms/1000) = 5s
    await runtime.handleSocketClose();

    expect(finalizeCallUsage).toHaveBeenCalledTimes(1);
    expect(finalizeCallUsage).toHaveBeenCalledWith(expect.objectContaining({ durationSeconds: 5 }));
  });

  it("does not double-finalize when explicit end and socket close race", async () => {
    const { deps, provider, clock, finalizeCallUsage } = makeDeps();
    const runtime = new CallSessionRuntime(makeSession(), makeClaims(), deps);
    await connectAndActivate(runtime, provider);

    clock.advanceMs(2_000);
    runtime.handleClientMessage(JSON.stringify({ type: "end" }));
    await runtime.handleSocketClose(); // races the in-flight end()

    await vi.waitFor(() => expect(finalizeCallUsage).toHaveBeenCalled());
    expect(finalizeCallUsage).toHaveBeenCalledTimes(1);
  });

  it("finalizes a zero-duration active call with zero usage", async () => {
    const { deps, provider, finalizeCallUsage } = makeDeps();
    const runtime = new CallSessionRuntime(makeSession(), makeClaims(), deps);
    await connectAndActivate(runtime, provider);

    runtime.handleClientMessage(JSON.stringify({ type: "end" })); // clock never advanced
    await vi.waitFor(() => expect(finalizeCallUsage).toHaveBeenCalled());

    expect(finalizeCallUsage).toHaveBeenCalledWith(expect.objectContaining({ durationSeconds: 0 }));
  });

  it("caps the effective max at the gateway's own MAX_CALL_SECONDS ceiling", async () => {
    const { deps, provider, events } = makeDeps({ maxCallSecondsCeiling: 1800 });
    const claims = makeClaims({ maxAllowedSeconds: 5000 }); // token asks for more than the ceiling
    const runtime = new CallSessionRuntime(makeSession(), claims, deps);

    await connectAndActivate(runtime, provider);

    expect(events.find((e) => e.type === "active")).toMatchObject({ maxAllowedSeconds: 1800 });
  });

  it("enforces maxAllowedSeconds: quota exhaustion finalizes exactly once at cutoff", async () => {
    vi.useFakeTimers();
    try {
      const { deps, provider, clock, events, finalizeCallUsage } = makeDeps({
        maxCallSecondsCeiling: 1800,
        quotaIntervalMs: 15_000,
      });
      const claims = makeClaims({ maxAllowedSeconds: 20 });
      const runtime = new CallSessionRuntime(makeSession(), claims, deps);

      await runtime.start();
      provider.emit({ type: "connected" });

      clock.advanceMs(20_000);
      await vi.advanceTimersByTimeAsync(20_000);

      expect(finalizeCallUsage).toHaveBeenCalledTimes(1);
      expect(finalizeCallUsage).toHaveBeenCalledWith(expect.objectContaining({ durationSeconds: 20 }));
      expect(events.filter((e) => e.type === "quota_exhausted")).toHaveLength(1);
      expect(events.filter((e) => e.type === "completed")).toHaveLength(1);

      // Triggering another end after quota already finalized must not recharge.
      runtime.handleClientMessage(JSON.stringify({ type: "end" }));
      await vi.advanceTimersByTimeAsync(0);
      expect(finalizeCallUsage).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("emits periodic quota updates with nonnegative remaining seconds", async () => {
    vi.useFakeTimers();
    try {
      const { deps, provider, clock, events } = makeDeps({
        maxCallSecondsCeiling: 1800,
        quotaIntervalMs: 15_000,
      });
      const claims = makeClaims({ maxAllowedSeconds: 120 });
      const runtime = new CallSessionRuntime(makeSession(), claims, deps);

      await runtime.start();
      provider.emit({ type: "connected" });

      clock.advanceMs(15_000);
      await vi.advanceTimersByTimeAsync(15_000);

      const quotaEvents = events.filter((e) => e.type === "quota");
      expect(quotaEvents.length).toBeGreaterThan(0);
      for (const e of quotaEvents) {
        expect(e).toMatchObject({ type: "quota" });
        if (e.type === "quota") expect(e.remainingSeconds).toBeGreaterThanOrEqual(0);
      }
      expect(quotaEvents.at(-1)).toMatchObject({ remainingSeconds: 105 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops accepting audio once the call is no longer active", async () => {
    const { deps, provider } = makeDeps();
    const runtime = new CallSessionRuntime(makeSession(), makeClaims(), deps);
    await connectAndActivate(runtime, provider);

    runtime.handleClientMessage(JSON.stringify({ type: "end" }));
    // Fire-and-forget end() has moved phase out of "active" synchronously.
    runtime.handleClientMessage(JSON.stringify({ type: "audio", data: "Zm9v" }));

    expect(provider.sentAudio).toHaveLength(0);
  });
});
