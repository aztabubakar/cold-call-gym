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

## Voice gateway trust boundary (Phase 3)

- `VOICE_GATEWAY_SIGNING_SECRET` is read only in
  `apps/web/src/lib/server/voice-token.ts` (guarded by `server-only`) and
  `services/voice-gateway/src/lib/token.ts` (a separate Node process, never
  bundled to a browser). Verified: no `"use client"` file imports either.
- The signed voice-session token has a 180-second TTL, carries no secrets
  and no scenario `hidden_state`, and its `maxAllowedSeconds` claim cannot
  be altered by the browser — tampering with it invalidates the HMAC
  signature (verified: `services/voice-gateway/src/lib/token.test.ts`).
- The gateway does not trust the token's claims beyond authentication: it
  re-validates the *live* `call_sessions` row (ownership, scenario match,
  state) before starting anything billable
  (`services/voice-gateway/src/lib/session-eligibility.ts`). Verified live
  (`e2e.gateway.test.ts`): a token minted for user A is rejected against
  user B's session (`forbidden`); a token for an already-`completed`
  session is rejected (`conflict`); a second connection attempt while a
  session is still active is rejected (`conflict`).
- The browser cannot submit a billable duration anywhere. The Phase 2
  `POST /api/voice/session/:id/finalize` development endpoint has been
  **removed**; the client→gateway WebSocket message schema
  (`ClientToGatewayMessageSchema`) has no duration field at all. Billing
  duration comes only from the gateway's own monotonic clock
  (`process.hrtime.bigint()`), verified in
  `services/voice-gateway/src/session-runtime.test.ts` by asserting the
  finalize call always uses the gateway-clock-derived value even when a
  test message carries a spoofed `durationSeconds` field.
- The gateway is the only additional caller of `finalize_call_usage()`
  beyond the (now-removed) web endpoint; it authenticates to Postgres with
  its own `SUPABASE_SERVICE_ROLE_KEY` (a separate env var on the gateway
  process, never shared with the browser) and is subject to the exact same
  atomicity/idempotency/role-lockdown guarantees documented above and in
  `supabase/migrations/003_entitlement_foundation.sql` — nothing about
  that RPC's security model changed for Phase 3.
- Finalization is guarded twice over: once in-process
  (`CallSessionRuntime`'s single-flight `endPromise`, so explicit `end`,
  socket close, and quota cutoff racing each other only run the finalize
  logic once) and once in the database (the RPC's idempotency key). Both
  are covered by tests, including a genuine same-process race
  (`session-runtime.test.ts`, "does not double-finalize when explicit end
  and socket close race").
