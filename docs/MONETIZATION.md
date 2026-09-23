# Monetization

## Business model: free plan only, no self-service payments

Cold Call Gym has **no paid credits, no purchased overflow, no
subscriptions, and no Stripe integration.** Every authenticated user gets a
single free daily allowance:

- **10 minutes (600 seconds) of AI voice practice per user, per UTC
  calendar day.**
- No rollover — unused time does not carry into tomorrow.
- When the allowance reaches zero, the app blocks starting new calls until
  it resets at the next UTC midnight.

Individuals or teams who need more than the free daily allowance use the
**Contact Sales** form (`/contact-sales`, backed by `POST
/api/contact-sales`) — there is no checkout, no payment method collection,
and no automated upgrade path. See `docs/PRD.md` for product framing and
`docs/SECURITY.md` for how sales inquiries are stored.

## Daily free allowance & UTC reset boundary

`DAILY_FREE_SECONDS = 600` (10 minutes). There is **no cron job or reset
row**: "today's usage" is always computed on read as

```
usedTodaySeconds =
  sum(call_sessions.free_seconds_used)
  where call_sessions.user_id = :user
    and call_sessions.usage_finalized_at is not null
    and call_sessions.usage_finalized_at >= date_trunc('day', now() at time zone 'utc')

remainingTodaySeconds = max(0, 600 - usedTodaySeconds)
canStartCall = remainingTodaySeconds > 0
```

Once `usage_finalized_at` rolls past midnight UTC, a session simply stops
counting toward "today" — the allowance is effectively reset without ever
mutating a stored balance. This is implemented twice, once in each place
usage is ever computed:
- `apps/web/src/lib/server/entitlement.ts` (`getEntitlement`, for display /
  authorization decisions)
- `supabase/migrations/004_free_plan_entitlement.sql`
  (`finalize_call_usage`, the only place that actually records usage)

We key off `usage_finalized_at` (when usage became final) rather than
`created_at` (when the session was created) or a client clock value, so the
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

Every finalize call is keyed by `idempotency_key = 'usage:<call_session_id>'`.
Calling `finalize_call_usage` twice for the same session — a retried
request, a duplicate gateway callback — is a strict no-op the second time:
the session isn't re-updated, the original result is returned with
`already_finalized: true`.

## Concurrency protection

See the header comment in
`supabase/migrations/004_free_plan_entitlement.sql` for the full strategy.
Summary: `finalize_call_usage` takes a `for update` lock on the session row
(serializes duplicate finalize calls for the *same* session) and a
`pg_advisory_xact_lock` keyed by user id (serializes concurrent finalize
calls across *different* sessions for the *same* user), then recomputes
today's used-seconds from scratch inside that lock before ever writing
`free_seconds_used`. This is what stops two concurrently-active sessions
(e.g. two browser tabs) from together overcounting past the 600-second
daily allowance. Verified against a real, concurrently-running pair of
Postgres transactions — see the Phase 2 development report (the mechanism
is unchanged from the original paid-credit-era implementation; only the
absence of paid overflow changed).

## Connected to the voice gateway

`POST /api/voice/session` creates the `authorized` call_sessions row,
computes `maxAllowedSeconds`, and signs a short-lived token for the voice
gateway. The gateway is the source of the duration passed to
`finalize_call_usage()` (via its own direct RPC call, using its own
service-role credentials) — not the browser. See
`docs/ARCHITECTURE.md`'s "Voice session lifecycle" section for the full
flow.

## Legacy: the old paid-credit model

Earlier phases implemented a paid-credit system (purchasable minutes,
one-time "welcome credits" at signup, a `credit_ledger` table). That model
has been **retired** in favor of the free-plan-only model above — see
`supabase/migrations/004_free_plan_entitlement.sql`. Nothing in the running
application reads or writes `credit_ledger` anymore; the table and the
now-unused `grant_welcome_credits()` function remain in the schema only to
avoid unnecessary migration risk against a live database (they're commented
as legacy/deprecated in that migration; see `docs/SECURITY.md`).
