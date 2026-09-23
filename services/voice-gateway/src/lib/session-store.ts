export type CallSessionRecord = {
  id: string;
  accessId: string;
  scenarioId: string;
  state: string;
  usageFinalizedAt: string | null;
  createdAt: string;
};

/**
 * Client for the web app's internal call-session API
 * (apps/web/src/app/api/internal/sessions/[id]/route.ts).
 *
 * With Supabase removed, the web app and the voice gateway — two separate
 * processes/services — no longer share a database connection. The web app
 * remains the source of truth for call-session state (it owns the
 * CallSessionStore); this module is what replaces "the gateway's own
 * Supabase service-role client" with "the gateway calling back into the
 * web app over HTTP using a shared secret." WEB_APP_URL and
 * INTERNAL_API_KEY must both be set, and INTERNAL_API_KEY must match the
 * web app's value exactly (see services/voice-gateway/.env.example).
 */

function baseUrl(): string | null {
  const url = process.env.WEB_APP_URL;
  return url ? url.replace(/\/$/, "") : null;
}

function apiKey(): string | null {
  return process.env.INTERNAL_API_KEY ?? null;
}

export function isSessionStoreConfigured(): boolean {
  return Boolean(baseUrl() && apiKey());
}

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const url = baseUrl();
  const key = apiKey();
  if (!url || !key) {
    throw new Error("WEB_APP_URL / INTERNAL_API_KEY are not configured");
  }

  return fetch(`${url}/api/internal/sessions${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
      ...(init.headers ?? {}),
    },
  });
}

export async function getCallSession(sessionId: string): Promise<CallSessionRecord | null> {
  const res = await call(`/${sessionId}`, { method: "GET" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`getCallSession failed with status ${res.status}`);
  return (await res.json()) as CallSessionRecord;
}

export async function transitionCallSessionState(sessionId: string, state: string): Promise<void> {
  const res = await call(`/${sessionId}`, {
    method: "POST",
    body: JSON.stringify({ action: "transition", state }),
  });
  if (!res.ok) throw new Error(`transitionCallSessionState failed with status ${res.status}`);
}

/**
 * Marks a session as `failed`. Used only when the mock (or future Gemini)
 * provider fails to connect BEFORE the session ever reached `active` — no
 * time was ever billable, so this bypasses finalizeUsage() entirely
 * rather than finalizing a zero-duration usage record.
 */
export async function markCallSessionFailed(sessionId: string): Promise<void> {
  const res = await call(`/${sessionId}`, {
    method: "POST",
    body: JSON.stringify({ action: "fail" }),
  });
  if (!res.ok) throw new Error(`markCallSessionFailed failed with status ${res.status}`);
}
