import { NextResponse } from "next/server";
import { AccessRequestSchema } from "@/lib/access-schema";
import { createAccessSession } from "@/lib/server/access";
import { isRateLimited, clientIpFromHeaders } from "@/lib/server/rate-limit";

/**
 * Accepts a Name + Email + Phone submission and grants immediate,
 * no-account access: creates a lead record and sets an opaque access
 * session cookie (see lib/server/access.ts — this is access gating, not
 * authentication). Public by design; nothing here requires or creates a
 * password. A filled-in honeypot field returns a normal-looking success
 * response without creating anything, so a bot can't tell its submission
 * was dropped.
 */
export async function POST(request: Request) {
  if (isRateLimited(`access:${clientIpFromHeaders(request.headers)}`, { max: 10, windowMs: 60_000 })) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const json = await request.json().catch(() => null);
  const parsed = AccessRequestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  if (parsed.data.website) {
    return NextResponse.json({ ok: true });
  }

  try {
    await createAccessSession(parsed.data);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("POST /api/access failed", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
