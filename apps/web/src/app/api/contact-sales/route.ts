import { NextResponse } from "next/server";
import { ContactSalesInquirySchema } from "@/lib/contact-sales-schema";
import { createSalesInquiry } from "@/lib/server/contact-sales";
import { isRateLimited, clientIpFromHeaders } from "@/lib/server/rate-limit";

/**
 * Accepts a "Contact Sales" inquiry. Public — does not require an access
 * session, since visitors evaluating the product may not have gone
 * through /start. All input is validated and length-capped server-side
 * (ContactSalesInquirySchema); a filled-in honeypot field causes a silent
 * no-op success response rather than an error, so a bot doesn't learn its
 * submission was rejected. Never exposes lead data belonging to anyone
 * other than the current visitor — see lib/server/contact-sales.ts.
 */
export async function POST(request: Request) {
  if (isRateLimited(`contact-sales:${clientIpFromHeaders(request.headers)}`, { max: 10, windowMs: 60_000 })) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const json = await request.json().catch(() => null);
  const parsed = ContactSalesInquirySchema.safeParse(json);
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
    await createSalesInquiry(parsed.data);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("POST /api/contact-sales failed", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
