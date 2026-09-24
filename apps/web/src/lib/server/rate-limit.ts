import "server-only";

/**
 * Minimal in-memory rate-limit hook for public, unauthenticated write
 * endpoints (/api/access, /api/contact-sales). This is a basic abuse
 * deterrent, NOT an identity mechanism — nothing about access is gated on
 * this or on IP address (see docs/SECURITY.md).
 *
 * Same limitation as memory-store.ts: this counter lives in process
 * memory, so it resets on every restart/deploy and is not shared across
 * multiple server instances. A real deployment fronted by more than one
 * instance needs a shared limiter (e.g. an edge/WAF rate limit, or a
 * Redis-backed one) — this is a hook to plug that into, not a
 * production-grade defense on its own.
 */

const hits = new Map<string, { count: number; resetAt: number }>();

export function isRateLimited(key: string, opts: { max: number; windowMs: number }): boolean {
  const now = Date.now();
  const entry = hits.get(key);

  if (!entry || entry.resetAt <= now) {
    hits.set(key, { count: 1, resetAt: now + opts.windowMs });
    return false;
  }

  entry.count += 1;
  return entry.count > opts.max;
}

/** Best-effort client identifier for rate limiting only — never used as an identity key. */
export function clientIpFromHeaders(headers: Headers): string {
  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0]!.trim();
  return headers.get("x-real-ip") ?? "unknown";
}
