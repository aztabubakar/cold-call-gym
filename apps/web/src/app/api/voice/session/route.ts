import { NextResponse } from "next/server";
import { z } from "zod";
import { CallAuthorizationSchema } from "@cold-call-gym/shared";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { authorizeCallSession } from "@/lib/server/entitlement";

const BodySchema = z.object({
  scenarioSlug: z.string().min(1).max(200),
});

/**
 * Server-side foundation for authorizing a future voice call. Does NOT
 * connect to Gemini or issue a signed voice-gateway token — that's Phase 3.
 * This validates the scenario, checks current entitlement, and creates an
 * `authorized` call_sessions row. Never returns service-role credentials,
 * Gemini credentials, or hidden scenario state.
 */
export async function POST(request: Request) {
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

  const json = await request.json().catch(() => null);
  const parsedBody = BodySchema.safeParse(json);
  if (!parsedBody.success) {
    return NextResponse.json(
      { error: "invalid_request", details: parsedBody.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const result = await authorizeCallSession(user.id, parsedBody.data.scenarioSlug);

    if ("error" in result) {
      if (result.error === "scenario_not_found") {
        return NextResponse.json({ error: "scenario_not_found" }, { status: 404 });
      }
      // 402 Payment Required: usable time is zero.
      return NextResponse.json(
        { error: "no_entitlement", entitlement: result.entitlement },
        { status: 402 },
      );
    }

    return NextResponse.json(CallAuthorizationSchema.parse(result.authorization), { status: 201 });
  } catch (err) {
    console.error("POST /api/voice/session failed", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
