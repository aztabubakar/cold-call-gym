import { NextResponse } from "next/server";
import { PracticeStatsSchema } from "@cold-call-gym/shared";
import { getCurrentLead } from "@/lib/server/access";
import { getPracticeStats } from "@/lib/server/entitlement";

/**
 * Returns the current access identity's practice-time stats. Cold Call
 * Gym has no accounts, no paid credits, no subscriptions, and no daily
 * cap (see docs/MONETIZATION.md) — this is purely informational (e.g.
 * "you've practiced 12m today" on the dashboard/call UI), always
 * recomputed server-side, never a client-supplied value.
 */
export async function GET() {
  const lead = await getCurrentLead();
  if (!lead) {
    return NextResponse.json({ error: "no_access_session" }, { status: 401 });
  }

  try {
    const stats = await getPracticeStats(lead.id);
    return NextResponse.json(PracticeStatsSchema.parse(stats));
  } catch (err) {
    console.error("GET /api/practice-stats failed", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
