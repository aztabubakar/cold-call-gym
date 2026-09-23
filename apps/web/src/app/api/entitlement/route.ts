import { NextResponse } from "next/server";
import { FreeEntitlementSchema } from "@cold-call-gym/shared";
import { getCurrentLead } from "@/lib/server/access";
import { getEntitlement } from "@/lib/server/entitlement";

/**
 * Returns the current access identity's free-plan entitlement. Cold Call
 * Gym has no accounts, no paid credits, and no subscriptions (see
 * docs/MONETIZATION.md) — this is the single source of truth the
 * dashboard and call UI read from, always recomputed server-side, never a
 * client-supplied value.
 */
export async function GET() {
  const lead = await getCurrentLead();
  if (!lead) {
    return NextResponse.json({ error: "no_access_session" }, { status: 401 });
  }

  try {
    const entitlement = await getEntitlement(lead.id);
    return NextResponse.json(FreeEntitlementSchema.parse(entitlement));
  } catch (err) {
    console.error("GET /api/entitlement failed", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
