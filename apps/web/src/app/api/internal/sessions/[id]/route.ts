import { NextResponse } from "next/server";
import { z } from "zod";
import { callSessionStore } from "@/lib/server/store";

/**
 * Internal, gateway-only API for the call-session store.
 *
 * The web app and the voice gateway are separate processes/services. With
 * Supabase removed, there is no shared database they can both talk to
 * directly — this small internal API is what replaces that shared
 * connection: the web app remains the source of truth (owns the
 * CallSessionStore), and the gateway calls back into it over HTTP using a
 * shared secret, instead of both sides holding credentials to a common
 * Postgres instance. This mirrors exactly what
 * services/voice-gateway/src/lib/{session-store,entitlement}.ts need
 * (get/transition/fail/finalize) and nothing more — it is not a general
 * public API and must never be reachable without the bearer token below.
 *
 * Never exposed to the browser: no NEXT_PUBLIC_ variable holds
 * INTERNAL_API_KEY, and nothing in client-rendered code imports this
 * route or its key.
 */

function checkAuth(request: Request): boolean {
  const expected = process.env.INTERNAL_API_KEY;
  if (!expected) return false;
  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  return provided.length > 0 && provided === expected;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const session = await callSessionStore.get(id);
  if (!session) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json(session);
}

const ActionBodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("transition"), state: z.string().min(1).max(50) }),
  z.object({ action: z.literal("fail") }),
  z.object({
    action: z.literal("finalize"),
    durationSeconds: z.number().min(0),
    idempotencyKey: z.string().min(1).max(200),
  }),
]);

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const json = await request.json().catch(() => null);
  const parsed = ActionBodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  try {
    if (parsed.data.action === "transition") {
      await callSessionStore.transitionState(id, parsed.data.state as never);
      return NextResponse.json({ ok: true });
    }

    if (parsed.data.action === "fail") {
      await callSessionStore.markFailed(id);
      return NextResponse.json({ ok: true });
    }

    const result = await callSessionStore.finalizeUsage({
      sessionId: id,
      durationSeconds: parsed.data.durationSeconds,
      idempotencyKey: parsed.data.idempotencyKey,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error(`POST /api/internal/sessions/${id} failed`, err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
