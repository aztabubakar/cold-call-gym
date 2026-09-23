import "server-only";
import { createServiceRoleClient } from "../supabase/service";
import { createClient } from "../supabase/server";
import type { ContactSalesInquiryInput } from "../contact-sales-schema";

function emptyToNull(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Inserts a sales inquiry using the service-role client — the browser never
 * gets write (or read) access to sales_inquiries directly (see
 * supabase/migrations/005_sales_inquiries.sql for the RLS default-deny).
 * Attaches the current session's user id when the visitor happens to be
 * signed in, purely for context — submitting an inquiry never requires
 * authentication.
 */
export async function createSalesInquiry(input: ContactSalesInquiryInput): Promise<void> {
  let userId: string | null = null;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    userId = user?.id ?? null;
  } catch {
    userId = null;
  }

  const service = createServiceRoleClient();
  const { error } = await service.from("sales_inquiries").insert({
    user_id: userId,
    name: input.name,
    work_email: input.workEmail,
    company: input.company,
    job_title: emptyToNull(input.jobTitle),
    team_size: emptyToNull(input.teamSize),
    phone: emptyToNull(input.phone),
    expected_usage: emptyToNull(input.expectedUsage),
    message: emptyToNull(input.message),
  });

  if (error) throw error;
}
