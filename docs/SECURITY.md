# Security & Privacy

## Secrets
Server only:
- Gemini API key
- Supabase service-role key
- Voice gateway signing secret (`VOICE_GATEWAY_SIGNING_SECRET`)

Cold Call Gym has no self-service payment flow, so there is no Stripe
secret key or webhook secret to manage (see `docs/MONETIZATION.md`).

## Audio
Default: do not persist raw audio.

## Transcripts
Make storage configurable and provide deletion controls.

## Abuse controls
- authenticated sessions
- max call duration
- server-side quota enforcement
- signed short-lived session tokens
- idempotent usage-finalization writes
- honeypot field + server-side validation on the public Contact Sales form

User content must not be able to:
- alter the daily usage allowance
- bypass time limits
- reveal hidden prospect state
- reveal secrets/system prompts
- read other users' data, including sales inquiries submitted by others

## Entitlement enforcement (free plan only)

Cold Call Gym has no paid credits (see `docs/MONETIZATION.md`) — this
section describes how the single free daily allowance is protected.

- `SUPABASE_SERVICE_ROLE_KEY` is read only in
  `apps/web/src/lib/supabase/service.ts`, guarded with the `server-only`
  package so a client-component import fails at build time. Verified: no
  `"use client"` file in the repo imports it, directly or transitively.
- The only code path that ever records billable usage against the daily
  allowance is the `finalize_call_usage` Postgres function
  (`supabase/migrations/004_free_plan_entitlement.sql`). `EXECUTE` on it is
  explicitly revoked from `public`, `anon`, and `authenticated` — only the
  `service_role` Postgres role, used exclusively by trusted server code,
  can call it. Verified live: calling it as `authenticated` raises
  `permission denied`.
- No API route accepts a balance, a usage amount, or a session `state` as
  user input. `POST /api/voice/session` accepts only a `scenarioSlug`.
  There is no browser-callable finalize endpoint at all — the voice gateway
  is the only caller of `finalize_call_usage()` (see below), and it
  supplies duration from its own server-side timer, never from the browser.
- New users receive **no** welcome/promotional grant of any kind — signup
  only creates a `profiles` row (`handle_new_user()` in
  `supabase/migrations/004_free_plan_entitlement.sql`). The old
  `grant_welcome_credits()` function is no longer called by anything.
- RLS policies from Phase 1 are unchanged and still verified live: a user
  querying another user's `call_sessions` rows gets zero rows back.
- Concurrent finalize attempts (same user, different sessions, racing) were
  run as two genuinely simultaneous Postgres transactions; the daily-used
  total never went negative and never exceeded the 600-second allowance.
  Re-verified live for the free-only model in
  `supabase/tests/free_plan_entitlement.sql`.

## Contact Sales

- `sales_inquiries` has row level security enabled with **no policies at
  all** for `anon`/`authenticated`
  (`supabase/migrations/005_sales_inquiries.sql`) — the default-deny means
  no user, including the submitter, can read, insert, update, or delete
  rows directly through the Supabase client, even if granted broad
  table-level access (verified live with an explicit table grant in
  `supabase/tests/free_plan_entitlement.sql`, to prove RLS itself is what
  blocks it, not just an absent grant).
- The only writer is `POST /api/contact-sales`
  (`apps/web/src/app/api/contact-sales/route.ts`), which validates and
  length-caps every field server-side (`ContactSalesInquirySchema` in
  `apps/web/src/lib/contact-sales-schema.ts`) before writing through the
  service-role client (`apps/web/src/lib/server/contact-sales.ts`). The
  route never requires authentication (visitors evaluating the product may
  not have an account) but attaches the submitter's user id when they
  happen to be signed in.
- A hidden honeypot field (`website`) causes the route to return a normal
  success response without writing anything, so a simple bot can't tell
  its submission was dropped.

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
- The gateway is the **only** caller of `finalize_call_usage()` — the
  web app never exposes a browser-callable finalize endpoint at all; it
  authenticates to Postgres with its own `SUPABASE_SERVICE_ROLE_KEY` (a
  separate env var on the gateway process, never shared with the browser)
  and is subject to the same atomicity/idempotency/role-lockdown guarantees
  documented in `supabase/migrations/004_free_plan_entitlement.sql`.
- Finalization is guarded twice over: once in-process
  (`CallSessionRuntime`'s single-flight `endPromise`, so explicit `end`,
  socket close, and quota cutoff racing each other only run the finalize
  logic once) and once in the database (the RPC's idempotency key). Both
  are covered by tests, including a genuine same-process race
  (`session-runtime.test.ts`, "does not double-finalize when explicit end
  and socket close race").
