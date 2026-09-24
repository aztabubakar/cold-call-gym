export type FinalizeUsageResult = {
  sessionId: string;
  state: string;
  durationSeconds: number;
  alreadyFinalized: boolean;
};

function baseUrl(): string | null {
  const url = process.env.WEB_APP_URL;
  return url ? url.replace(/\/$/, "") : null;
}

function apiKey(): string | null {
  return process.env.INTERNAL_API_KEY ?? null;
}

/**
 * Gateway-side call into the web app's internal finalize action (see
 * apps/web/src/app/api/internal/sessions/[id]/route.ts and
 * apps/web/src/lib/server/store/memory-store.ts's finalizeUsage()). This
 * is the trust boundary: the gateway is the only thing that decides
 * `durationSeconds` (from its own monotonic timer — see
 * src/session-runtime.ts), and it calls this endpoint directly with its
 * own INTERNAL_API_KEY, never by asking the browser to submit a duration
 * over HTTP. The web app's store remains atomic and idempotent
 * (idempotencyKey); this wrapper doesn't change that behavior, it's just
 * a second authorized caller. Calls are free and unlimited — there are no
 * credits and nothing is ever deducted.
 */
export async function finalizeCallUsage(params: {
  sessionId: string;
  durationSeconds: number;
  idempotencyKey: string;
}): Promise<FinalizeUsageResult> {
  const url = baseUrl();
  const key = apiKey();
  if (!url || !key) {
    throw new Error("WEB_APP_URL / INTERNAL_API_KEY are not configured");
  }

  const safeDuration = Math.max(0, Math.floor(params.durationSeconds));

  const res = await fetch(`${url}/api/internal/sessions/${params.sessionId}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      action: "finalize",
      durationSeconds: safeDuration,
      idempotencyKey: params.idempotencyKey,
    }),
  });

  if (!res.ok) throw new Error(`finalizeCallUsage failed with status ${res.status}`);
  return (await res.json()) as FinalizeUsageResult;
}
