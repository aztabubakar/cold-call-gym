import { z } from "zod";

/**
 * Validation for the /start access form (name + email + phone + consent).
 * No `server-only` import, so it's unit-testable directly. Server-side
 * validation is the only validation that matters for security — this
 * schema is also reused client-side purely for UX, never trusted as-is
 * from the browser.
 */

function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/[^0-9]/g, "");
  return (hasPlus ? "+" : "") + digits;
}

export const AccessRequestSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(200, "Name is too long")
    .refine((v) => /\p{L}/u.test(v), "Enter a valid name"),
  email: z
    .string()
    .trim()
    .min(3, "Email is required")
    .max(320, "Email is too long")
    .email("Enter a valid email address")
    .transform((v) => v.toLowerCase()),
  // International phone numbers vary widely in length/format — normalize
  // to digits (with an optional leading '+') rather than assuming a US
  // 10-digit shape, and validate against E.164's 15-digit max rather than
  // a fixed length.
  phone: z
    .string()
    .trim()
    .min(1, "Phone number is required")
    .max(40, "Phone number is too long")
    .transform(normalizePhone)
    .refine((v) => /^\+?[0-9]{7,15}$/.test(v), "Enter a valid phone number"),
  consent: z.literal(true, {
    errorMap: () => ({ message: "Please confirm you'd like us to follow up" }),
  }),
  // Honeypot: real visitors never see or fill this (hidden via CSS);
  // simple bots that fill every field often do. Not constrained to be
  // empty here — the caller checks it after a successful parse and
  // returns a normal-looking success response when it's nonempty, so a
  // bot can't tell its submission was silently dropped.
  website: z.string().max(2000).optional(),
});

export type AccessRequestInput = z.infer<typeof AccessRequestSchema>;
