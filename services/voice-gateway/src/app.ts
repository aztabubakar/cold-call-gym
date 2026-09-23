import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import { MockVoiceProvider } from "./providers/mock-provider.js";
import { GeminiLiveProvider } from "./providers/gemini-live-provider.js";
import type { VoiceProvider } from "./providers/voice-provider.js";
import { systemClock, type Clock } from "./lib/clock.js";
import { verifyVoiceSessionToken, isTokenVerificationConfigured } from "./lib/token.js";
import {
  getCallSession,
  transitionCallSessionState,
  markCallSessionFailed,
  isSessionStoreConfigured,
  type CallSessionRecord,
} from "./lib/session-store.js";
import { finalizeCallUsage as realFinalizeCallUsage, type FinalizeUsageResult } from "./lib/entitlement.js";
import { evaluateSessionEligibility } from "./lib/session-eligibility.js";
import { CallSessionRuntime } from "./session-runtime.js";
import type { GatewayToClientEvent } from "@cold-call-gym/shared";

export type AppDeps = {
  clock: Clock;
  maxCallSecondsCeiling: number;
  quotaIntervalMs: number;
  createProvider: () => VoiceProvider;
  getCallSession: (sessionId: string) => Promise<CallSessionRecord | null>;
  transitionCallSessionState: (sessionId: string, state: string) => Promise<void>;
  markCallSessionFailed: (sessionId: string) => Promise<void>;
  finalizeCallUsage: (params: {
    sessionId: string;
    durationSeconds: number;
    idempotencyKey: string;
  }) => Promise<FinalizeUsageResult>;
  isSessionStoreConfigured: () => boolean;
};

function defaultDeps(): AppDeps {
  return {
    clock: systemClock,
    maxCallSecondsCeiling: Number(process.env.MAX_CALL_SECONDS ?? 1800),
    quotaIntervalMs: 15_000,
    createProvider: () =>
      (process.env.VOICE_PROVIDER ?? "mock") === "gemini" ? new GeminiLiveProvider() : new MockVoiceProvider(),
    getCallSession,
    transitionCallSessionState,
    markCallSessionFailed,
    finalizeCallUsage: realFinalizeCallUsage,
    isSessionStoreConfigured,
  };
}

/**
 * Builds the Fastify app. Production (src/index.ts) calls this with no
 * arguments and gets the real implementation, which calls the web app's
 * internal session API over HTTP (see lib/session-store.ts and
 * lib/entitlement.ts); tests can inject fakes for getCallSession/
 * transitionCallSessionState/markCallSessionFailed/finalizeCallUsage to
 * exercise the full real WebSocket + token-verification +
 * session-runtime pipeline without a running web app (see
 * src/e2e.gateway.test.ts).
 */
export function buildApp(overrides: Partial<AppDeps> = {}): FastifyInstance {
  const deps: AppDeps = { ...defaultDeps(), ...overrides };

  const app = Fastify({ logger: true });

  // Tracks which call_sessions currently have a live gateway connection in
  // THIS process, so a second connection attempt for the same session is
  // rejected outright rather than racing the first. This is process-local:
  // a horizontally-scaled gateway (multiple instances) needs a shared store
  // (e.g. Redis) for this invariant to hold across instances — documented as
  // a Phase 7 follow-up, not solved here.
  const activeSessionIds = new Set<string>();

  app.get("/health", async () => ({
    status: "ok",
    service: "voice-gateway",
    provider: process.env.VOICE_PROVIDER ?? "mock",
    tokenVerification: isTokenVerificationConfigured() ? "configured" : "not_configured",
    sessionStore: deps.isSessionStoreConfigured() ? "configured" : "not_configured",
  }));

  // The `{ websocket: true }` route shorthand is only understood once
  // @fastify/websocket has finished registering its onRoute hook — that
  // registration is asynchronous, so the /ws route MUST be declared inside
  // an awaited nested plugin, not just after a bare (un-awaited)
  // `app.register(websocket)` call. Getting this wrong doesn't error: the
  // route silently falls back to being a plain HTTP handler receiving
  // (request, reply) instead of (socket, request), which is a nasty
  // footgun to debug (confirmed empirically while building this).
  app.register(async (instance) => {
    // Bounds the raw WebSocket frame size at the transport level, defense
    // in depth on top of ClientToGatewayMessageSchema's own per-field
    // length caps (e.g. MAX_AUDIO_CHUNK_BASE64_CHARS) — a malformed/hostile
    // client can't force an oversized payload through to JSON.parse at all.
    await instance.register(websocket, { options: { maxPayload: 1_048_576 } });

    instance.get("/ws", { websocket: true }, (socket, request) => {
      const url = new URL(request.url, "http://localhost");
      const token = url.searchParams.get("token") ?? undefined;

      function send(event: GatewayToClientEvent) {
        if (socket.readyState === 1) socket.send(JSON.stringify(event));
      }

      function closeWithError(errorCode: string, wsCloseCode: number, message: string) {
        send({ type: "error", code: errorCode, message });
        send({ type: "closed" });
        socket.close(wsCloseCode, errorCode);
      }

      void (async () => {
        const verification = await verifyVoiceSessionToken(token);
        if (!verification.ok) {
          app.log.warn({ code: verification.code }, "voice session token rejected");
          closeWithError("unauthorized", 4401, "Invalid or expired session token.");
          return;
        }
        const { claims } = verification;

        if (!deps.isSessionStoreConfigured()) {
          closeWithError("internal_error", 1011, "Gateway session store is not configured.");
          return;
        }

        let session;
        try {
          session = await deps.getCallSession(claims.sessionId);
        } catch (err) {
          app.log.error({ err: String(err) }, "failed to load call session");
          closeWithError("internal_error", 1011, "Could not load the call session.");
          return;
        }

        if (!session) {
          closeWithError("not_found", 4404, "Call session not found.");
          return;
        }

        // The gateway does NOT blindly trust the token's claims beyond
        // authentication — it re-verifies ownership and eligibility against
        // the live database row before doing anything billable.
        const eligibility = evaluateSessionEligibility(session, claims);
        if (!eligibility.ok) {
          app.log.warn(
            { sessionId: claims.sessionId, state: session.state, code: eligibility.code },
            "session not eligible to start",
          );
          const wsCode = eligibility.code === "forbidden" ? 4403 : 4409;
          const message =
            eligibility.code === "forbidden"
              ? "This session does not belong to the presented token."
              : "This call session cannot be started or resumed.";
          closeWithError(eligibility.code, wsCode, message);
          return;
        }

        if (activeSessionIds.has(session.id)) {
          closeWithError("conflict", 4409, "This call session already has an active connection.");
          return;
        }

        activeSessionIds.add(session.id);
        const releaseSession = () => activeSessionIds.delete(session.id);

        app.log.info({ sessionId: session.id }, "session authorized, socket connecting");

        const runtime = new CallSessionRuntime(session, claims, {
          clock: deps.clock,
          maxCallSecondsCeiling: deps.maxCallSecondsCeiling,
          quotaIntervalMs: deps.quotaIntervalMs,
          log: app.log,
          createProvider: deps.createProvider,
          finalizeCallUsage: deps.finalizeCallUsage,
          markCallSessionFailed: deps.markCallSessionFailed,
          transitionCallSessionState: deps.transitionCallSessionState,
          send,
          closeSocket: (code, reason) => socket.close(code, reason),
        });

        socket.on("message", (raw: Buffer) => runtime.handleClientMessage(raw.toString()));
        socket.on("close", () => {
          releaseSession();
          void runtime.handleSocketClose();
        });

        send({ type: "connected" });
        await runtime.start();
      })().catch((err) => {
        app.log.error({ err: String(err) }, "unhandled voice session error");
        try {
          closeWithError("internal_error", 1011, "Internal server error.");
        } catch {
          // socket may already be closed
        }
      });
    });
  });

  return app;
}
