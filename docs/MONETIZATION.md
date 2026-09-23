# Monetization

## Business model: free access, no accounts, no self-service payments

Cold Call Gym has **no accounts, no paid credits, no purchased overflow, no
subscriptions, and no Stripe integration.** Submitting name + email + phone at `/start` grants
immediate free access:

- **10 minutes (600 seconds) of AI voice practice per access identity, per UTC
  calendar day.**
- No rollover — unused time does not carry into tomorrow.
- When the allowance reaches zero, the app blocks starting new calls until
  it resets at the next UTC midnight.

Individuals or teams who need more than the free daily allowance use the
**Contact Sales** form (`/contact-sales`, backed by `POST
/api/contact-sales`) — there is no checkout, no payment method collection,
and no automated upgrade path. See `docs/PRD.md` for product framing and
`docs/SECURITY.md` for how leads and sales inquiries are stored, and for what an "access
identity" does and doesn't prove.

## Daily free allowance & UTC reset boundary

`DAILY_FREE_SECONDS = 600` (10 minutes). There is **no cron job or reset
row**: "today's usage" is always computed on read as

```
usedTodaySeconds =
  sum(callSession.freeSecondsUsed)
  where callSession.accessId = :accessId
    and callSession.usageFinalizedAt is not null
    and callSession.usageFinalizedAt >= start of today (UTC)

remainingTodaySeconds = max(0, 600 - usedTodaySeconds)
canStartCall = remainingTodaySeconds > 0
```

Once `usageFinalizedAt` rolls past midnight UTC, a session simply stops
counting toward "today" — the allowance is effectively reset without ever
mutating a stored balance. This is implemented in one place now (there is no
separate database function to keep in sync): `apps/web/src/lib/server/store/usage-math.ts`
(`sumUsedToday`, `computeFinalize`), used by both `getEntitlement()`
(`apps/web/src/lib/server/entitlement.ts`) and the active `CallSessionStore`'s `finalizeUsage()`
(`apps/web/src/lib/server/store/{memory-store,redis-store}.ts` — see
`docs/ARCHITECTURE.md`'s "Storage abstraction" for which one is active where).

We key off `usageFinalizedAt` (when usage became final) rather than
`createdAt` (when the session was created) or a client clock value, so the
"usage date" always reflects trusted server timestamps.

## Authorizing a call

A call may only be authorized when `remainingTodaySeconds > 0`. The maximum
duration a single call is authorized for is:

```
maxAllowedSeconds = min(remainingTodaySeconds, MAX_CALL_SECONDS)
```

(`MAX_CALL_SECONDS`, default 1800s, is the voice gateway's own absolute
safety ceiling, independent of entitlement — see `docs/ARCHITECTURE.md`.)
Both `remainingTodaySeconds > 0` and this cap are recomputed server-side on
every authorization; the browser is never trusted to assert either one, and
the signed voice-session token that carries `maxAllowedSeconds` to the
gateway cannot be altered without invalidating its signature.

## Idempotency

Every finalize call is keyed by `idempotencyKey = 'usage:<sessionId>'`.
Calling finalize twice for the same session — a retried
request, a duplicate gateway callback — is a strict no-op the second time:
the record isn't re-updated, the original result is returned with
`alreadyFinalized: true`.

## Concurrency protection

Both `finalizeUsage()` implementations recompute today's used-seconds from scratch before ever
writing `freeSecondsUsed`, which is what stops two concurrently-active sessions (e.g. two browser
tabs) from together overcounting past the 600-second daily allowance — but they get atomicity
different ways:

- **`memory-store.ts`** (local dev fallback): runs synchronously to completion (no `await` between
  reading and writing shared state), so JavaScript's single-threaded execution model gives genuine
  atomicity **within one process only** — see its doc comment. Verified in
  `apps/web/src/lib/server/store/usage-math.test.ts`.
- **`redis-store.ts`** (production, when `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` are
  set — see `docs/DEPLOYMENT.md`): network round-trips mean synchronous execution can't provide
  this for free, so `finalizeUsage()` wraps its read-recompute-write sequence in a real distributed
  lock scoped per access identity (`redis-lock.ts`, `SET key value NX PX ttl`) — the same purpose
  as the old Postgres per-user advisory lock, different mechanism. This is what makes the
  concurrency guarantee hold **across multiple Vercel serverless instances**, not just within one
  process. Verified in `redis-store.test.ts` and `redis-lock.test.ts` (including that two
  concurrent callers on the same key genuinely serialize).

## Connected to the voice gateway

`POST /api/voice/session` creates the `authorized` call-session record,
computes `maxAllowedSeconds`, and signs a short-lived token for the voice
gateway. The gateway is the source of the duration passed to
`finalizeUsage()` (via the web app's internal session API, using its own
`INTERNAL_API_KEY` credential) — not the browser. See
`docs/ARCHITECTURE.md`'s "Voice session lifecycle" section for the full
flow.

## Legacy: Supabase and the old paid-credit model

Earlier phases implemented an account-based, Supabase/Postgres-backed system, including at one
point a paid-credit system (purchasable minutes, one-time "welcome credits" at signup, a
`credit_ledger` table). Both the accounts and the paid-credit model have been **retired** — Cold
Call Gym now has no accounts and no relational database of any kind. The old migrations are
archived at `legacy/supabase/` purely as a historical record; nothing in the running application
reads from or writes to them. (There is now a lightweight Redis-backed store for lead/call-session
records in production — see `docs/ARCHITECTURE.md`'s "Storage abstraction" — but it's a simple
key-value store with no schema/migrations, not a relational database.)
