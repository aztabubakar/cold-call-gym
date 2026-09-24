import { z } from "zod";

/**
 * Validation schema for a "Contact Sales" inquiry — the only path to
 * anything beyond self-service (voice practice itself is free and
 * unlimited), since Cold Call Gym has no self-service payment flow (see
 * docs/MONETIZATION.md). Deliberately free of any server-only import
 * (unlike lib/server/contact-sales.ts) so it can be unit-tested directly
 * without a Next.js server-rendering context.
 */
export const ContactSalesInquirySchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  workEmail: z.string().trim().min(3).max(320).email("Enter a valid work email"),
  company: z.string().trim().min(1, "Company is required").max(200),
  jobTitle: z.string().trim().max(200).optional(),
  teamSize: z.string().trim().max(100).optional(),
  phone: z.string().trim().max(50).optional(),
  expectedUsage: z.string().trim().max(500).optional(),
  message: z.string().trim().max(4000).optional(),
  // Honeypot: a real visitor never sees or fills this field (hidden via
  // CSS in the form); simple bots that fill every input often do.
  // Deliberately NOT constrained to be empty here — the caller checks this
  // after a successful parse and returns a normal-looking success response
  // when it's nonempty, so a bot can't tell its submission was silently
  // dropped instead of saved (a validation error at this layer would give
  // the trap away).
  website: z.string().max(2000).optional(),
});

export type ContactSalesInquiryInput = z.infer<typeof ContactSalesInquirySchema>;
