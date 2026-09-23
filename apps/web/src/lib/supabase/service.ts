import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client. Bypasses RLS entirely — this is the ONLY
 * client allowed to write to call_sessions / credit_ledger, and it must
 * never be imported from client-rendered code. SUPABASE_SERVICE_ROLE_KEY is
 * a server-only env var (no NEXT_PUBLIC_ prefix) and is never sent to the
 * browser.
 */
export function createServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Supabase service-role credentials are not configured");
  }

  return createSupabaseClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
