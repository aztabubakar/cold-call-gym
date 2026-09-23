import { NextResponse } from "next/server";
import { FreeEntitlementSchema } from "@cold-call-gym/shared";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { getEntitlement } from "@/lib/server/entitlement";

/**
 * Returns the authenticated user's free-plan entitlement. Cold Call Gym has
 * no paid credits or subscriptions (see docs/MONETIZATION.md) — this is the
 * single source of truth the dashboard and call UI read from, always
 * recomputed server-side, never a client-supplied value.
 */
export async function GET() {
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

  try {
    const entitlement = await getEntitlement(user.id);
    return NextResponse.json(FreeEntitlementSchema.parse(entitlement));
  } catch (err) {
    console.error("GET /api/entitlement failed", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
