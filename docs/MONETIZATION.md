# Monetization

## Business model: free, unlimited access, no accounts, no self-service payments

Cold Call Gym has **no accounts, no paid credits, no purchased overflow, no
subscriptions, and no Stripe integration.** Submitting name + email + phone at `/start` grants
immediate free access:

- **AI voice practice is free and unlimited** — no daily allowance, no per-call ceiling,
  nothing to run out of.
- Calls run until the caller ends them, the browser tab closes, or the provider connection
  drops.

Individuals or teams wanting anything beyond self-service (dedicated support, custom scenarios,
seats/reporting for a sales team) use the **Contact Sales** form (`/contact-sales`, backed by
`POST /api/contact-sales`) — there is no checkout, no payment method collection, and no
automated upgrade path. See `docs/PRD.md` for product framing and `docs/SECURITY.md` for how
leads and sales inquiries are stored, and for what an "access identity" does and doesn't prove.

## Practice-time stats

There is no allowance to track against, but the dashboard and call UI show a purely
informational "practiced today" stat, computed on read:

```
usedTodaySeconds =
  sum(callSession.durationSeconds)
  where callSession.accessId = :accessId
    and callSession.usageFinalizedAt is not null
    and callSession.usageFinalizedAt >= start of today (UTC)
```

This never gates anything — it exists only so a caller can see how much they've practiced.
Implemented in `apps/web/src/lib/server/store/usage-math.ts` (`sumUsedToday`), used by
`getPracticeStats()` (`apps/web/src/lib/server/entitlement.ts`) and exposed at `GET
/api/practice-stats`.

We key off `usageFinalizedAt` (when usage became final) rather than `createdAt` (when the
session was created) or a client clock value, so "today" always reflects trusted server
timestamps.

## Authorizing a call

Any call may be authorized — the only failure mode is an unknown scenario slug. There is no
entitlement check and no ceiling: `authorizeCallSession()`
(`apps/web/src/lib/server/entitlement.ts`) just creates the `authorized` call-session record and
lets `POST /api/voice/session` sign a short-lived token for the voice gateway. See
`docs/ARCHITECTURE.md`'s "Voice session lifecycle" section for the full flow.

## Idempotency

Every finalize call is keyed by `idempotencyKey = 'usage:<sessionId>'`.
Calling finalize twice for the same session — a retried
request, a duplicate gateway callback — is a strict no-op the second time:
the record isn't re-updated, the original result is returned with
`alreadyFinalized: true`.

## Duration clamping (defense in depth)

`finalizeUsage()` doesn't cap duration against any allowance, but it does clamp the gateway's
claimed `durationSeconds` to the wall-clock time actually elapsed since the session was created
— a sanity ceiling on top of the gateway's own monotonic timer, in case a claim is ever
implausible. Implemented in `apps/web/src/lib/server/store/usage-math.ts`'s `computeFinalize`,
verified in `usage-math.test.ts`.

- **`memory-store.ts`** (local dev fallback): runs synchronously to completion, so a single
  process never races itself.
- **`redis-store.ts`** (production, when `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` are
  set — see `docs/DEPLOYMENT.md`): wraps `finalizeUsage()`'s read-check-write sequence in a real
  distributed lock scoped per session (`redis-lock.ts`, `SET key value NX PX ttl`) so a
  read-modify-write race can't finalize the same session's usage twice across concurrent Vercel
  serverless instances. Verified in `redis-store.test.ts` and `redis-lock.test.ts`.

## Legacy: Supabase, the old paid-credit model, and the old daily allowance

Earlier phases implemented an account-based, Supabase/Postgres-backed system, including at one
point a paid-credit system (purchasable minutes, one-time "welcome credits" at signup, a
`credit_ledger` table), and later a free daily allowance (600 seconds/UTC day, with an
independent per-call ceiling on top of it). All of that has been **retired** — Cold Call Gym now
has no accounts, no relational database, and no cap on practice time at all. The old migrations
are archived at `legacy/supabase/` purely as a historical record; nothing in the running
application reads from or writes to them. (There is now a lightweight Redis-backed store for
lead/call-session records in production — see `docs/ARCHITECTURE.md`'s "Storage abstraction" —
but it's a simple key-value store with no schema/migrations, not a relational database.)
