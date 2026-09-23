import { NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { ContactSalesInquirySchema } from "@/lib/contact-sales-schema";
import { createSalesInquiry } from "@/lib/server/contact-sales";

/**
 * Accepts a "Contact Sales" inquiry. Public — does not require
 * authentication, since visitors evaluating the product may not have an
 * account yet. All input is validated and length-capped server-side
 * (ContactSalesInquirySchema); a filled-in honeypot field causes a silent
 * no-op success response rather than an error, so a bot doesn't learn its
 * submission was rejected. Never touches or exposes the service-role key to
 * the browser — the write happens entirely inside createSalesInquiry().
 */
export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "supabase_not_configured" }, { status: 503 });
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
