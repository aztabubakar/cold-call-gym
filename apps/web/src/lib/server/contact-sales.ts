import "server-only";
import { salesInquiryStore } from "./store";
import { getCurrentLead } from "./access";
import type { ContactSalesInquiryInput } from "../contact-sales-schema";

function emptyToNull(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Records a sales inquiry. Attaches the current access session's lead id
 * when the visitor has one (purely for context — never exposed back to
 * any other visitor), but submitting an inquiry never requires it: a
 * visitor evaluating the product may not have gone through /start at all.
 */
export async function createSalesInquiry(input: ContactSalesInquiryInput): Promise<void> {
  const lead = await getCurrentLead();
  const leadId = lead?.id ?? null;

  await salesInquiryStore.create({
    leadId,
    name: input.name,
    workEmail: input.workEmail,
    company: input.company,
    jobTitle: emptyToNull(input.jobTitle),
    teamSize: emptyToNull(input.teamSize),
    phone: emptyToNull(input.phone),
    expectedUsage: emptyToNull(input.expectedUsage),
    message: emptyToNull(input.message),
  });
}
