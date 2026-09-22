import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { buildApp, type AppDeps } from "./app.js";
import { MockVoiceProvider } from "./providers/mock-provider.js";
import { systemClock } from "./lib/clock.js";
import type { CallSessionRow } from "./lib/supabase.js";
import type { GatewayToClientEvent } from "@cold-call-gym/shared";

/**
 * True end-to-end test of the gateway: a real Fastify server, a real
 * WebSocket connection (Node's built-in global WebSocket — the same API a
 * browser uses), real JWT signing/verification via `jose`, and the real
 * CallSessionRuntime state machine. The only thing NOT real here is the
 * database layer: a full Supabase project (Postgres + PostgREST + GoTrue)
 * needs Docker, which isn't available in this environment (no daemon). In
 * its place, an in-memory fake implements the same
 * getCallSession/transitionCallSessionState/markCallSessionFailed/
 * finalizeCallUsage contract that services/voice-gateway/src/lib/{supabase,
 * entitlement}.ts implement against real Supabase — this proves the
 * gateway's own wiring end-to-end (auth boundary, WebSocket protocol,
 * lifecycle, duplicate/reconnect rejection) even though it can't prove the
 * real Postgres round-trip. The real Postgres round-trip for
 * finalize_call_usage() itself (atomicity, idempotency, concurrency) was
 * separately verified in supabase/tests/phase2_entitlement.sql against a
 * live local Postgres 16 instance and is unchanged in Phase 3.
 */

const SECRET = "e2e-test-signing-secret";

function createFakeDb() {
  const sessions = new Map<string, CallSessionRow & { duration_seconds?: number; free_seconds_used?: number; paid_credits_used?: number }>();
  let freeUsedToday = 0;
  let paidBalance = 100;

  return {
    sessions,
    async getCallSession(sessionId: string) {
      return sessions.get(sessionId) ?? null;
    },
    async transitionCallSessionState(sessionId: string, state: string) {
      const row = sessions.get(sessionId);
      if (row) row.state = state;
    },
    async markCallSessionFailed(sessionId: string) {
      const row = sessions.get(sessionId);
      if (row) row.state = "failed";
    },
    async finalizeCallUsage(params: { sessionId: string; durationSeconds: number; idempotencyKey: string }) {
      const row = sessions.get(params.sessionId);
      if (!row) throw new Error("session not found");

      if (row.usage_finalized_at) {
        return {
          sessionId: row.id,
          state: row.state,
          durationSeconds: row.duration_seconds ?? 0,
          freeSecondsUsed: row.free_seconds_used ?? 0,
          paidCreditsUsed: row.paid_credits_used ?? 0,
          alreadyFinalized: true,
        };
      }

      const freeUsed = Math.max(0, Math.min(600 - freeUsedToday, params.durationSeconds));
      freeUsedToday += freeUsed;
      const paidSecondsNeeded = Math.max(0, params.durationSeconds - freeUsed);
      const paidUsed = Math.min(paidBalance, Math.ceil(paidSecondsNeeded / 60));
      paidBalance -= paidUsed;

      row.state = "completed";
      row.usage_finalized_at = new Date().toISOString();
      row.duration_seconds = params.durationSeconds;
      row.free_seconds_used = freeUsed;
      row.paid_credits_used = paidUsed;

      return {
        sessionId: row.id,
        state: "completed",
        durationSeconds: params.durationSeconds,
        freeSecondsUsed: freeUsed,
        paidCreditsUsed: paidUsed,
        alreadyFinalized: false,
      };
    },
    isDatabaseConfigured: () => true,
  };
}

function addSession(
  db: ReturnType<typeof createFakeDb>,
  overrides: Partial<CallSessionRow> = {},
): CallSessionRow {
  const row: CallSessionRow = {
    id: overrides.id ?? randomUUID(),
    user_id: "user-1",
    scenario_id: "scenario-1",
    state: "authorized",
    usage_finalized_at: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
  db.sessions.set(row.id, row);
  return row;
}

async function signToken(
  claims: Partial<{ sub: string; sessionId: string; scenarioId: string; maxAllowedSeconds: number }> = {},
) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    sessionId: claims.sessionId ?? "session-1",
    scenarioId: claims.scenarioId ?? "scenario-1",
    maxAllowedSeconds: claims.maxAllowedSeconds ?? 5,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub ?? "user-1")
    .setIssuedAt(now)
    .setExpirationTime(now + 180)
    .setJti(randomUUID())
    .sign(new TextEncoder().encode(SECRET));
}

function waitForEvent(
  events: GatewayToClientEvent[],
  predicate: (e: GatewayToClientEvent) => boolean,
): Promise<void> {
  return vi.waitFor(
    () => {
      if (!events.some(predicate)) throw new Error("event not yet received");
    },
    { timeout: 3000, interval: 10 },
  );
}

function collectEvents(ws: WebSocket): GatewayToClientEvent[] {
  const events: GatewayToClientEvent[] = [];
  ws.onmessage = (message) => {
    try {
      events.push(JSON.parse(message.data as string));
    } catch {
      // ignore
    }
  };
  return events;
}

function waitOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    ws.onopen = () => resolve();
    ws.onerror = () => resolve(); // let event-based assertions handle the rejection path
  });
}

describe("voice gateway end-to-end (real server, real WebSocket)", () => {
  let db: ReturnType<typeof createFakeDb>;
  let app: ReturnType<typeof buildApp>;
  let httpBaseUrl: string;
  let wsBaseUrl: string;

  beforeEach(async () => {
    process.env.VOICE_GATEWAY_SIGNING_SECRET = SECRET;
    db = createFakeDb();

    const deps: Partial<AppDeps> = {
      clock: systemClock,
      maxCallSecondsCeiling: 1800,
      quotaIntervalMs: 60_000, // long enough to not fire during these short tests
      createProvider: () => new MockVoiceProvider(),
      // Wrapped rather than passed directly so a later vi.spyOn(db, "...")
      // in an individual test is observed dynamically via property lookup,
      // instead of buildApp() permanently capturing the original
      // (pre-spy) function reference.
      getCallSession: (sessionId) => db.getCallSession(sessionId),
      transitionCallSessionState: (sessionId, state) => db.transitionCallSessionState(sessionId, state),
      markCallSessionFailed: (sessionId) => db.markCallSessionFailed(sessionId),
      finalizeCallUsage: (params) => db.finalizeCallUsage(params),
      isDatabaseConfigured: () => db.isDatabaseConfigured(),
    };
    app = buildApp(deps);
    await app.listen({ port: 0, host: "127.0.0.1" });

    const address = app.server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    httpBaseUrl = `http://127.0.0.1:${port}`;
    wsBaseUrl = `ws://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await app.close();
    delete process.env.VOICE_GATEWAY_SIGNING_SECRET;
  });

  it("GET /health reports configuration status without leaking secrets", async () => {
    const res = await fetch(`${httpBaseUrl}/health`);
    const body = await res.json();
    expect(body).toEqual({
      status: "ok",
      service: "voice-gateway",
      provider: "mock",
      tokenVerification: "configured",
      database: "configured",
    });
    expect(JSON.stringify(body)).not.toContain(SECRET);
  });

  it("full lifecycle: authorize -> connect -> active -> end -> completed, and the DB reflects finalized usage exactly once", async () => {
    const finalizeSpy = vi.spyOn(db, "finalizeCallUsage");
    const session = addSession(db);
    const token = await signToken({ sessionId: session.id });

    const ws = new WebSocket(`${wsBaseUrl}/ws?token=${token}`);
    const events = collectEvents(ws);
    await waitOpen(ws);

    await waitForEvent(events, (e) => e.type === "connected");
    await waitForEvent(events, (e) => e.type === "active");

    ws.send(JSON.stringify({ type: "end" }));
    await waitForEvent(events, (e) => e.type === "completed");

    const completed = events.find((e) => e.type === "completed");
    expect(completed).toMatchObject({ type: "completed", sessionId: session.id });
    if (completed?.type === "completed") {
      expect(completed.durationSeconds).toBeGreaterThanOrEqual(0);
      expect(completed.freeSecondsUsed).toBeGreaterThanOrEqual(0);
    }

    const row = db.sessions.get(session.id)!;
    expect(row.state).toBe("completed");
    expect(row.usage_finalized_at).not.toBeNull();

    // Sending `end` again on the same (now-closing) socket must not
    // double-finalize.
    ws.send(JSON.stringify({ type: "end" }));
    await new Promise((r) => setTimeout(r, 50));
    expect(finalizeSpy).toHaveBeenCalledTimes(1);

    ws.close();
  });

  it("rejects a second connection while the first is still active (duplicate socket rejected)", async () => {
    const session = addSession(db);
    const token1 = await signToken({ sessionId: session.id });

    const ws1 = new WebSocket(`${wsBaseUrl}/ws?token=${token1}`);
    const events1 = collectEvents(ws1);
    await waitOpen(ws1);
    await waitForEvent(events1, (e) => e.type === "active");

    const token2 = await signToken({ sessionId: session.id });
    const ws2 = new WebSocket(`${wsBaseUrl}/ws?token=${token2}`);
    const events2 = collectEvents(ws2);
    await waitOpen(ws2);

    await waitForEvent(events2, (e) => e.type === "error");
    const errorEvent = events2.find((e) => e.type === "error");
    expect(errorEvent).toMatchObject({ type: "error", code: "conflict" });

    // The first connection is unaffected and can still complete normally.
    ws1.send(JSON.stringify({ type: "end" }));
    await waitForEvent(events1, (e) => e.type === "completed");

    ws1.close();
    ws2.close();
  });

  it("rejects reconnecting to an already-completed session with a fresh token", async () => {
    const session = addSession(db);
    const token1 = await signToken({ sessionId: session.id });

    const ws1 = new WebSocket(`${wsBaseUrl}/ws?token=${token1}`);
    const events1 = collectEvents(ws1);
    await waitOpen(ws1);
    await waitForEvent(events1, (e) => e.type === "active");
    ws1.send(JSON.stringify({ type: "end" }));
    await waitForEvent(events1, (e) => e.type === "completed");
    ws1.close();

    const token2 = await signToken({ sessionId: session.id });
    const ws2 = new WebSocket(`${wsBaseUrl}/ws?token=${token2}`);
    const events2 = collectEvents(ws2);
    await waitOpen(ws2);

    await waitForEvent(events2, (e) => e.type === "error");
    expect(events2.find((e) => e.type === "error")).toMatchObject({ code: "conflict" });

    ws2.close();
  });

  it("rejects a token for a session that doesn't exist, without ever finalizing anything", async () => {
    const finalizeSpy = vi.spyOn(db, "finalizeCallUsage");
    const token = await signToken({ sessionId: "no-such-session" });

    const ws = new WebSocket(`${wsBaseUrl}/ws?token=${token}`);
    const events = collectEvents(ws);
    await waitOpen(ws);

    await waitForEvent(events, (e) => e.type === "error");
    expect(events.find((e) => e.type === "error")).toMatchObject({ code: "not_found" });
    expect(finalizeSpy).not.toHaveBeenCalled();

    ws.close();
  });

  it("rejects cross-user token/session mismatch (token minted for a different user)", async () => {
    const session = addSession(db, { user_id: "the-real-owner" });
    const token = await signToken({ sessionId: session.id, sub: "an-attacker" });

    const ws = new WebSocket(`${wsBaseUrl}/ws?token=${token}`);
    const events = collectEvents(ws);
    await waitOpen(ws);

    await waitForEvent(events, (e) => e.type === "error");
    expect(events.find((e) => e.type === "error")).toMatchObject({ code: "forbidden" });

    ws.close();
  });

  it("rejects an invalid/garbage token before ever touching the database", async () => {
    const getSpy = vi.spyOn(db, "getCallSession");
    const ws = new WebSocket(`${wsBaseUrl}/ws?token=not-a-real-token`);
    const events = collectEvents(ws);
    await waitOpen(ws);

    await waitForEvent(events, (e) => e.type === "error");
    expect(events.find((e) => e.type === "error")).toMatchObject({ code: "unauthorized" });
    expect(getSpy).not.toHaveBeenCalled();

    ws.close();
  });
});
