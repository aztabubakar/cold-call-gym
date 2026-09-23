import {
  ClientToGatewayMessageSchema,
  buildPersonaSystemInstruction,
  getScenarioBySlug,
  type GatewayToClientEvent,
  type VoiceSessionTokenClaims,
} from "@cold-call-gym/shared";
import type { VoiceEvent, VoiceProvider, VoiceProviderErrorCode } from "./providers/voice-provider.js";
import type { Clock } from "./lib/clock.js";
import type { CallSessionRecord } from "./lib/session-store.js";
import type { FinalizeUsageResult } from "./lib/entitlement.js";

export type Logger = {
  info: (obj: Record<string, unknown>, msg?: string) => void;
  warn: (obj: Record<string, unknown>, msg?: string) => void;
  error: (obj: Record<string, unknown>, msg?: string) => void;
};

export type CallSessionRuntimeDeps = {
  clock: Clock;
  /** Gateway's own MAX_CALL_SECONDS safety ceiling, independent of the token. */
  maxCallSecondsCeiling: number;
  quotaIntervalMs: number;
  log: Logger;
  createProvider: () => VoiceProvider;
  finalizeCallUsage: (params: {
    sessionId: string;
    durationSeconds: number;
    idempotencyKey: string;
  }) => Promise<FinalizeUsageResult>;
  markCallSessionFailed: (sessionId: string) => Promise<void>;
  transitionCallSessionState: (sessionId: string, state: string) => Promise<void>;
  send: (event: GatewayToClientEvent) => void;
  closeSocket: (code: number, reason: string) => void;
};

type Phase = "connecting" | "active" | "ending" | "completed" | "failed";

/**
 * Owns one authorized call_sessions row for the lifetime of one WebSocket
 * connection. This is where Phase 3's core guarantee lives: billable
 * duration comes ONLY from this class's own monotonic clock between
 * becoming `active` and ending, never from anything the browser sends.
 *
 * State machine:
 *   connecting -> active -> ending -> completed
 *   connecting -> failed                          (provider never connected)
 *
 * Finalization (the only path that records billable usage) is guarded so it runs
 * at most once per connection regardless of how many triggers fire —
 * explicit `end`, socket close, quota cutoff, or a provider error can all
 * race, but only the first one does anything; the rest observe the same
 * in-flight/resolved promise. The underlying finalize_call_usage() RPC is
 * itself idempotent too, so this is defense in depth, not the only guard.
 */
export class CallSessionRuntime {
  private readonly effectiveMaxSeconds: number;
  private phase: Phase = "connecting";
  private activeStartNs: bigint | null = null;
  private quotaTimer: ReturnType<typeof setInterval> | null = null;
  private cutoffTimer: ReturnType<typeof setTimeout> | null = null;
  private provider: VoiceProvider | null = null;
  private endPromise: Promise<void> | null = null;

  constructor(
    private readonly session: CallSessionRecord,
    private readonly claims: VoiceSessionTokenClaims,
    private readonly deps: CallSessionRuntimeDeps,
  ) {
    this.effectiveMaxSeconds = Math.max(
      0,
      Math.min(claims.maxAllowedSeconds, deps.maxCallSecondsCeiling),
    );
  }

  get sessionId(): string {
    return this.session.id;
  }

  get currentPhase(): Phase {
    return this.phase;
  }

  /** Begins connecting to the voice provider. Call once, right after construction. */
  async start(): Promise<void> {
    this.deps.log.info({ sessionId: this.sessionId }, "session connecting");
    await this.deps.transitionCallSessionState(this.sessionId, "connecting").catch((err) => {
      this.deps.log.error({ sessionId: this.sessionId, err: String(err) }, "state transition failed");
    });

    this.provider = this.deps.createProvider();
    this.provider.onEvent((event) => this.handleProviderEvent(event));

    // The token's scenarioId is a scenario slug (see packages/shared's
    // scenario catalog) — looked up directly here, no network call, so the
    // persona/objections/difficulty reach the voice provider even if the
    // web app is briefly unreachable mid-connect.
    const scenario = getScenarioBySlug(this.claims.scenarioId);
    const systemPrompt = buildPersonaSystemInstruction(scenario);

    try {
      await this.provider.connect({ systemPrompt });
    } catch (err) {
      await this.handlePreActiveFailure(String(err instanceof Error ? err.message : err));
    }
  }

  /** Handles one inbound WebSocket message from the browser. */
  handleClientMessage(raw: string): void {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      this.deps.send({ type: "error", code: "invalid_message", message: "Message was not valid JSON." });
      return;
    }

    const parsed = ClientToGatewayMessageSchema.safeParse(json);
    if (!parsed.success) {
      this.deps.send({ type: "error", code: "invalid_message", message: "Unrecognized message shape." });
      return;
    }

    const message = parsed.data;
    if (message.type === "ping") {
      this.deps.send({ type: "pong" });
      return;
    }

    if (message.type === "audio") {
      // Only forward audio while genuinely active — once we're ending
      // (quota exhausted, wrapping up) we stop accepting new audio, per
      // the documented lifecycle.
      if (this.phase === "active" && this.provider) {
        void this.provider.sendAudio(message.data);
      }
      return;
    }

    if (message.type === "end") {
      void this.end("client_end");
    }
  }

  /** Called when the underlying WebSocket closes, for any reason. */
  async handleSocketClose(): Promise<void> {
    if (this.phase === "completed" || this.phase === "failed") return;

    if (this.phase === "connecting") {
      await this.handlePreActiveFailure("socket closed before the call became active");
      return;
    }

    // active or ending: finalize whatever active time actually elapsed.
    await this.end("disconnect");
  }

  private handleProviderEvent(event: VoiceEvent): void {
    switch (event.type) {
      case "connected": {
        if (this.phase !== "connecting") return;
        this.becomeActive();
        return;
      }
      case "text": {
        if (this.phase === "active") {
          this.deps.send({ type: "text", text: event.text });
        }
        return;
      }
      case "audio": {
        // Native provider audio (Gemini's PCM16/24kHz response), relayed to
        // the browser as-is — see docs/ARCHITECTURE.md's "Audio transport".
        if (this.phase === "active") {
          this.deps.send({ type: "audio", data: event.data });
        }
        return;
      }
      case "interrupted": {
        // Barge-in: the caller started speaking over the prospect. The
        // browser must stop/clear queued playback immediately.
        if (this.phase === "active") {
          this.deps.send({ type: "interrupted" });
        }
        return;
      }
      case "transcript": {
        if (this.phase === "active") {
          this.deps.send({ type: "transcript", role: event.role, text: event.text, final: event.final });
        }
        return;
      }
      case "error": {
        if (this.phase === "connecting") {
          void this.handlePreActiveFailure(event.message, event.code);
        } else if (this.phase === "active") {
          void this.end("provider_error");
        }
        return;
      }
      case "closed": {
        // The provider closing on its own while we're still active is
        // equivalent to a disconnect from the provider's side.
        if (this.phase === "active") {
          void this.end("provider_closed");
        }
        return;
      }
    }
  }

  private becomeActive(): void {
    this.phase = "active";
    this.activeStartNs = this.deps.clock.nowNs();

    void this.deps.transitionCallSessionState(this.sessionId, "active").catch((err) => {
      this.deps.log.error({ sessionId: this.sessionId, err: String(err) }, "state transition failed");
    });

    this.deps.log.info({ sessionId: this.sessionId }, "session active");
    this.deps.send({
      type: "active",
      sessionId: this.sessionId,
      maxAllowedSeconds: this.effectiveMaxSeconds,
    });

    if (this.effectiveMaxSeconds <= 0) {
      void this.end("quota_exhausted");
      return;
    }

    this.quotaTimer = setInterval(() => this.emitQuotaUpdate(), this.deps.quotaIntervalMs);
    this.cutoffTimer = setTimeout(() => void this.end("quota_exhausted"), this.effectiveMaxSeconds * 1000);
  }

  private computeElapsedSeconds(): number {
    if (this.activeStartNs === null) return 0;
    const elapsedNs = this.deps.clock.nowNs() - this.activeStartNs;
    const elapsedMs = Number(elapsedNs / 1_000_000n);
    // Final active duration = ceil(elapsed ms / 1000): any nonzero active
    // time bills at least 1 second; truly zero elapsed time bills zero.
    return Math.max(0, Math.ceil(elapsedMs / 1000));
  }

  private emitQuotaUpdate(): void {
    if (this.phase !== "active") return;
    const remaining = Math.max(0, this.effectiveMaxSeconds - this.computeElapsedSeconds());
    this.deps.send({ type: "quota", remainingSeconds: remaining });
  }

  private clearTimers(): void {
    if (this.quotaTimer) {
      clearInterval(this.quotaTimer);
      this.quotaTimer = null;
    }
    if (this.cutoffTimer) {
      clearTimeout(this.cutoffTimer);
      this.cutoffTimer = null;
    }
  }

  /** Provider never reached `active` — no billable time, mark failed, no RPC call. */
  private async handlePreActiveFailure(
    message: string,
    code: VoiceProviderErrorCode = "provider_unavailable",
  ): Promise<void> {
    if (this.phase !== "connecting") return;
    this.phase = "failed";
    this.clearTimers();

    this.deps.log.warn({ sessionId: this.sessionId, reason: message, code }, "session failed before active");

    try {
      await this.deps.markCallSessionFailed(this.sessionId);
    } catch (err) {
      this.deps.log.error({ sessionId: this.sessionId, err: String(err) }, "failed to mark session failed");
    }

    // A friendly, generic message — never the provider's raw error text,
    // which could describe internal implementation details.
    this.deps.send({ type: "error", code, message: "We couldn't start the AI prospect. Please try again." });
    this.deps.send({ type: "closed" });
    this.deps.closeSocket(1011, code);
  }

  /**
   * The finalization guard: no matter which of {client `end`, socket
   * close, quota cutoff, provider error/close} triggers this first, only
   * that first call does any work. Every other caller observes the same
   * promise.
   */
  private end(reason: string): Promise<void> {
    if (this.endPromise) return this.endPromise;
    this.endPromise = this.doEnd(reason);
    return this.endPromise;
  }

  private async doEnd(reason: string): Promise<void> {
    if (this.phase !== "active") {
      // Nothing billable ever started (shouldn't normally reach here since
      // handleSocketClose() routes pre-active closes to
      // handlePreActiveFailure instead, but guard defensively).
      return;
    }

    this.phase = "ending";
    this.clearTimers();

    if (reason === "quota_exhausted") {
      this.deps.send({ type: "quota_exhausted" });
    }

    if (this.provider) {
      await this.provider.close().catch((err) => {
        this.deps.log.warn({ sessionId: this.sessionId, err: String(err) }, "provider close failed");
      });
    }

    const durationSeconds = this.computeElapsedSeconds();
    const idempotencyKey = `usage:${this.sessionId}`;

    this.deps.log.info({ sessionId: this.sessionId, reason, durationSeconds }, "session ending");

    try {
      const result = await this.deps.finalizeCallUsage({
        sessionId: this.sessionId,
        durationSeconds,
        idempotencyKey,
      });
      this.phase = "completed";
      this.deps.log.info(
        {
          sessionId: this.sessionId,
          durationSeconds: result.durationSeconds,
          freeSecondsUsed: result.freeSecondsUsed,
        },
        "session completed",
      );
      this.deps.send({
        type: "completed",
        sessionId: this.sessionId,
        durationSeconds: result.durationSeconds,
        freeSecondsUsed: result.freeSecondsUsed,
      });
    } catch (err) {
      this.deps.log.error({ sessionId: this.sessionId, err: String(err) }, "finalize failed");
      this.deps.send({ type: "error", code: "finalize_failed", message: "Could not finalize the call." });
    } finally {
      this.deps.send({ type: "closed" });
      this.deps.closeSocket(1000, "completed");
    }
  }
}
