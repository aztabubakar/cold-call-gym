import { NextResponse } from "next/server";
import { z } from "zod";
import { CallAuthorizationSchema } from "@cold-call-gym/shared";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { authorizeCallSession } from "@/lib/server/entitlement";
import { signVoiceSessionToken } from "@/lib/server/voice-token";

const BodySchema = z.object({
  scenarioSlug: z.string().min(1).max(200),
});

/**
 * Authorizes a future voice call. Validates the scenario and current
 * entitlement, creates an `authorized` call_sessions row, and signs a
 * short-lived token the browser presents to the voice gateway to open a
 * WebSocket connection. Never returns service-role credentials, the gateway
 * signing secret, Gemini credentials, or hidden scenario state — only what
 * the browser needs to connect and render the call UI.
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

  const gatewayUrl = process.env.VOICE_GATEWAY_URL;
  if (!gatewayUrl) {
    console.error("POST /api/voice/session: VOICE_GATEWAY_URL is not configured");
    return NextResponse.json({ error: "gateway_not_configured" }, { status: 503 });
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

    const { authorization } = result;
    const { token } = await signVoiceSessionToken({
      userId: user.id,
      sessionId: authorization.sessionId,
      scenarioId: authorization.scenarioId,
      maxAllowedSeconds: authorization.maxAllowedSeconds,
    });

    return NextResponse.json(
      CallAuthorizationSchema.parse({
        ...authorization,
        gatewayUrl,
        token,
      }),
      { status: 201 },
    );
  } catch (err) {
    console.error("POST /api/voice/session failed", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
