# Security & Privacy

## Secrets
Server only:
- Gemini API key
- Stripe secret key
- Stripe webhook secret
- Supabase service-role key

## Audio
Default: do not persist raw audio.

## Transcripts
Make storage configurable and provide deletion controls.

## Abuse controls
- authenticated sessions
- max call duration
- rate limiting
- server-side quota enforcement
- signed short-lived session tokens
- webhook signature verification
- idempotent billing writes

User content must not be able to:
- alter credit balance
- bypass time limits
- reveal hidden prospect state
- reveal secrets/system prompts

## Entitlement enforcement (Phase 2)

- `SUPABASE_SERVICE_ROLE_KEY` is read only in
  `apps/web/src/lib/supabase/service.ts`, guarded with the `server-only`
  package so a client-component import fails at build time. Verified: no
  `"use client"` file in the repo imports it, directly or transitively.
- The only code path that ever debits paid credits is the
  `finalize_call_usage` Postgres function
  (`supabase/migrations/003_entitlement_foundation.sql`). `EXECUTE` on it
  (and on `grant_welcome_credits`) is explicitly revoked from `public`,
  `anon`, and `authenticated` — only the `service_role` Postgres role, used
  exclusively by trusted server code, can call it. Verified live: calling
  either function as `authenticated` raises `permission denied`.
- No API route accepts a `credits_delta`, a balance, or a session `state`
  as user input. `POST /api/voice/session` accepts only a `scenarioSlug`;
  `POST /api/voice/session/:id/finalize` accepts only a claimed
  `durationSeconds`, which the database clamps against wall-clock time
  before it can affect a balance.
- Welcome credits are granted exactly once per user, from a database
  trigger on `auth.users` insert (not from any client-callable endpoint),
  using the deterministic idempotency key `welcome:<user_id>`. Verified
  live: a duplicate grant attempt is a no-op.
- `finalizeCallUsage()` checks session ownership (`call_sessions.user_id =
  authenticated user`) before invoking the RPC, so one user can never
  finalize (and thus can never affect the billing of) another user's
  session.
- RLS policies from Phase 1 are unchanged and still verified live: a user
  querying another user's `credit_ledger` or `call_sessions` rows gets zero
  rows back.
- Concurrent finalize attempts (same user, different sessions, racing) were
  run as two genuinely simultaneous Postgres transactions; the balance
  never went negative and the total charged never exceeded what was
  available. See the Phase 2 development report for the exact run.
