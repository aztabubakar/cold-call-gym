import "server-only";
import { cookies } from "next/headers";
import { leadStore } from "./store";
import type { Lead } from "./store";
import { ACCESS_COOKIE_NAME } from "../access-cookie";

/**
 * Access-session cookie handling.
 *
 * This is ACCESS GATING, not authentication. The cookie's value is a
 * server-generated opaque identifier (a lead's id — never their email or
 * phone) that unlocks the practice UI. It does not prove who the visitor
 * is: it only proves "this browser previously submitted the /start form
 * and was handed this identifier." Anyone who has the cookie value has the
 * access it grants — there is no password, no email/phone verification,
 * and no way to distinguish the real lead from someone who copied their
 * cookie. Clearing cookies (or submitting the form again with different
 * contact info) gets a visitor a brand new lead id — voice practice is
 * free and unlimited (see docs/MONETIZATION.md), so this has no scarce
 * resource to bypass; see docs/SECURITY.md for the full limitations and
 * how this could be hardened later (e.g. email OTP or phone verification)
 * without redesigning the voice session architecture — the store
 * interfaces in ./store/types.ts are deliberately identity-agnostic about
 * how an accessId came to be trusted.
 */

const ACCESS_COOKIE_MAX_AGE_SECONDS = 180 * 24 * 60 * 60; // 180 days

export { ACCESS_COOKIE_NAME };

export async function createAccessSession(input: {
  name: string;
  email: string;
  phone: string;
  consent: boolean;
}): Promise<Lead> {
  const lead = await leadStore.create(input);

  const cookieStore = await cookies();
  cookieStore.set(ACCESS_COOKIE_NAME, lead.id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ACCESS_COOKIE_MAX_AGE_SECONDS,
  });

  return lead;
}

/** Reads the raw access identifier from the cookie, if present. Does NOT validate it against the store. */
export async function getAccessId(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(ACCESS_COOKIE_NAME)?.value ?? null;
}

/** Reads the cookie AND resolves it to a real lead. Returns null for a missing, cleared, or unknown identifier. */
export async function getCurrentLead(): Promise<Lead | null> {
  const accessId = await getAccessId();
  if (!accessId) return null;
  return leadStore.get(accessId);
}
