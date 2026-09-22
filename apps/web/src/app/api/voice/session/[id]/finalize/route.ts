import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { finalizeCallUsage } from "@/lib/server/entitlement";

const BodySchema = z.object({
  durationSeconds: z.number().min(0),
});

/**
 * Development-safe usage-finalization endpoint for the Phase 2 mock call
 * flow. `durationSeconds` is the browser's own timer — presentation state
 * only. It is never trusted directly: finalizeCallUsage() clamps it against
 * server-side timestamps before any credits are debited. Once the real
 * voice-gateway integration lands (Phase 3), the gateway itself will call
 * this same finalization path with server-metered duration instead of the
 * browser.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "supabase_not_configured" }, { status: 503 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id: sessionId } = await params;
  const json = await request.json().catch(() => null);
  const parsedBody = BodySchema.safeParse(json);
  if (!parsedBody.success) {
    return NextResponse.json(
      { error: "invalid_request", details: parsedBody.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const result = await finalizeCallUsage({
      userId: user.id,
      sessionId,
      claimedDurationSeconds: parsedBody.data.durationSeconds,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof Error && err.message === "session_not_found_or_forbidden") {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    console.error("POST /api/voice/session/[id]/finalize failed", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
