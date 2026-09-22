# Monetization

## Free plan
Suggested launch:
- 10 minutes/day (600 seconds)
- basic coaching
- limited starter scenarios

## Paid credits
Sell understandable voice minutes, not LLM tokens.
- 1 credit = 60 seconds
- consume free allowance first
- never allow negative balance
- keep immutable ledger

## Ledger transaction types
purchase, usage, refund, promotional_grant, admin_adjustment, expiration

## Stripe flow
1. Server creates Checkout Session.
2. User pays on Stripe.
3. Stripe webhook arrives.
4. Verify signature.
5. Store event idempotently.
6. Add ledger credit.
7. UI reads updated balance.

Never grant credits from the browser success redirect alone.

---

## Phase 2 implementation (entitlement + ledger)

### Daily free allowance & UTC reset boundary
`DAILY_FREE_SECONDS = 600` (10 minutes). There is **no cron job or reset
row**: "today's free seconds used" is always computed on read as

```
freeSecondsUsedToday =
  sum(call_sessions.free_seconds_used)
  where call_sessions.user_id = :user
    and call_sessions.usage_finalized_at is not null
    and call_sessions.usage_finalized_at >= date_trunc('day', now() at time zone 'utc')

freeSecondsRemaining = max(0, 600 - freeSecondsUsedToday)
```

Once `usage_finalized_at` rolls past midnight UTC, a session simply stops
counting toward "today" — the allowance is effectively reset without
mutating any stored balance. This is implemented twice, once in each place
usage is ever computed:
- `apps/web/src/lib/server/entitlement.ts` (`getEntitlement`, for display /
  authorization decisions)
- `supabase/migrations/003_entitlement_foundation.sql`
  (`finalize_call_usage`, the only place that actually charges usage)

We key off `usage_finalized_at` (when usage became final) rather than
`created_at` (when the session was created) or a client clock value, so the
"usage date" always reflects trusted server timestamps.

### Paid credit balance
Never stored as a mutable integer. Always derived as
`sum(credit_ledger.credits_delta)` for the user, clamped to `>= 0` for
display. `credit_ledger.idempotency_key` is `unique`, which is what makes
every ledger write — purchases, refunds, promotional grants, and usage
debits alike — safe to retry without double-applying.

### Partial-minute rounding
1 credit = any **started** 60-second block:

| Paid seconds needed | Credits charged |
|---|---|
| 1s | 1 |
| 60s | 1 |
| 61s | 2 |
| 120s | 2 |
| 121s | 3 |

`paid_credits_used = ceil(paid_seconds_needed / 60)`, capped at the user's
available balance — usage is never allowed to push the balance negative; if
a claimed duration would need more credits than are available, only the
available credits are charged (and the corresponding seconds), rather than
extending credit.

### Idempotency
Every usage-debiting ledger row is written with
`idempotency_key = 'usage:<call_session_id>'` via
`insert ... on conflict (idempotency_key) do nothing`. Calling
`finalize_call_usage` twice for the same session — a retried request, a
duplicate gateway callback — is a strict no-op the second time: no new
ledger row, no change to the session, the original result is returned with
`already_finalized: true`. Welcome credits use `idempotency_key =
'welcome:<user_id>'` for the same reason.

### Concurrency protection
See the header comment in
`supabase/migrations/003_entitlement_foundation.sql` for the full strategy.
Summary: `finalize_call_usage` takes a `for update` lock on the session row
(serializes duplicate finalize calls for the *same* session) and a
`pg_advisory_xact_lock` keyed by user id (serializes concurrent finalize
calls across *different* sessions for the *same* user), then recomputes the
balance from scratch inside that lock before charging. This was verified
against a real, concurrently-running pair of Postgres transactions — see
the Phase 2 development report.

### Connecting to Phase 3 (real voice gateway)
`POST /api/voice/session` already creates the `authorized` call_sessions row
and computes `maxAllowedSeconds`; Phase 3 adds a signed, short-lived token
derived from that authorization for the voice gateway to present, and wires
the gateway's own server-side timer (instead of the browser's timer used in
the Phase 2 mock flow) as the source of `claimedDurationSeconds` passed to
`finalizeCallUsage`. The finalize path itself does not need to change.
