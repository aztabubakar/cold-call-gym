import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type CallSessionRow = {
  id: string;
  user_id: string;
  scenario_id: string;
  state: string;
  usage_finalized_at: string | null;
  created_at: string;
};

let client: SupabaseClient | null = null;

/**
 * Service-role Supabase client for the gateway process. Bypasses RLS —
 * this process never runs in a browser, and SUPABASE_SERVICE_ROLE_KEY is
 * only ever read from server-side environment variables (see
 * services/voice-gateway/.env.example). Lazily constructed so `/health` can
 * report "not_configured" instead of crashing the process at import time.
 */
export function getSupabaseClient() {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not configured");
  }

  client = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  return client;
}

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export async function getCallSession(sessionId: string): Promise<CallSessionRow | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("call_sessions")
    .select("id, user_id, scenario_id, state, usage_finalized_at, created_at")
    .eq("id", sessionId)
    .maybeSingle();

  if (error) throw error;
  return (data as CallSessionRow | null) ?? null;
}

export async function transitionCallSessionState(sessionId: string, state: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("call_sessions").update({ state }).eq("id", sessionId);
  if (error) throw error;
}

/**
 * Marks a session as `failed` with zero usage. Used only when the mock (or
 * future Gemini) provider fails to connect BEFORE the session ever reached
 * `active` — no time was ever billable, so this bypasses
 * finalize_call_usage() entirely rather than finalizing a zero-duration
 * usage record. finalize_call_usage() also refuses to run against a
 * `failed` session, which keeps a failed session from ever being
 * (re)finalized later.
 */
export async function markCallSessionFailed(sessionId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("call_sessions")
    .update({ state: "failed", ended_at: new Date().toISOString() })
    .eq("id", sessionId);
  if (error) throw error;
}
