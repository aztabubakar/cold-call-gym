# Architecture

Browser ↔ Next.js web app ↔ Supabase
              |
              └── signed voice session token
                       |
                       v
                Voice Gateway
                       |
                       v
                 Gemini Live

## Web responsibilities
- auth
- dashboard
- scenarios
- contact sales UI (the only path to expanded access — no billing UI, no
  self-service payments; see docs/MONETIZATION.md)
- call history
- coaching report UI
- create short-lived voice authorization

## Voice gateway responsibilities
- validate user/session
- load scenario/persona
- check entitlement
- connect to Gemini Live
- relay audio
- meter time server-side
- terminate when quota is exhausted
- finalize usage
- write session outcome

## Call states
created → authorized → connecting → active → ending → completed
                                              ↘ failed

## Why separate voice gateway?
Real-time audio is long-lived and stateful. A dedicated gateway is easier to operate than a short-lived serverless handler.

## Entitlement (free plan only)
Cold Call Gym has no paid credits (see `docs/MONETIZATION.md`) — every user
gets a single free daily allowance (600 seconds/UTC day, no rollover). All
entitlement logic lives server-side, split across two layers:

- `apps/web/src/lib/server/entitlement.ts` — server-only module (never
  imported by client components) using a service-role Supabase client that
  bypasses RLS. Exposes `getEntitlement` and `authorizeCallSession`.
- `supabase/migrations/004_free_plan_entitlement.sql` — the
  `finalize_call_usage` Postgres function, which is the *only* code path
  that ever records billable usage. It runs the calculation and the
  `call_sessions` update inside one atomic, locked transaction, and only
  the `service_role` Postgres role may execute it (`authenticated`/`anon`
  are explicitly revoked).

API surface:
- `GET /api/entitlement` — authenticated user's current free-plan
  entitlement (`{ plan, dailyLimitSeconds, usedTodaySeconds,
  remainingTodaySeconds, canStartCall, resetsAt }`).
- `POST /api/voice/session` — authorizes a call (validates scenario +
  entitlement, creates an `authorized` call_sessions row, signs a
  short-lived voice-gateway token, returns `maxAllowedSeconds`).
- There is no browser-callable finalize endpoint. The voice gateway is the
  only caller of `finalize_call_usage()`, using its own service-role
  credentials and its own server-metered duration — see "Voice session
  lifecycle" below.

See `docs/MONETIZATION.md` for the allowance/rounding rules and
`docs/SECURITY.md` for what's locked down and why.

## Voice session lifecycle (Phase 3)

```
Browser                    Next.js web app              Voice Gateway         Postgres
   |  POST /api/voice/session   |                            |                    |
   |--------------------------->| validate auth+scenario+    |                    |
   |                            | entitlement, insert         |                    |
   |                            | call_sessions(authorized)   |--------------------|
   |                            | sign short-lived JWT        |                    |
   |<---------------------------| {sessionId, gatewayUrl,     |                    |
   |                            |  token, maxAllowedSeconds}  |                    |
   |  wss://gateway/ws?token=…                                |                    |
   |----------------------------------------------------------->| verify JWT sig+exp |
   |                                                            | load session,      |
   |                                                            | verify ownership +  |
   |                                                            | eligibility ------->|
   |                                                            | authorized->connecting|
   |                                                            | connect mock provider |
   |<----------------------------------------------------------| {type:"connected"}  |
   |<----------------------------------------------------------| {type:"active", …}  | connecting->active,
   |                                                            | start monotonic timer|
   |<----------------------------------------------------------| {type:"quota", …}   | (every ~15s)
   |  {type:"end"}  ------------------------------------------->|                     |
   |                                                            | stop timer, close    |
   |                                                            | provider, call       |
   |                                                            | finalize_call_usage()|
   |                                                            | (service-role RPC) ->|
   |<----------------------------------------------------------| {type:"completed", …}| completed
```

### The signed voice-session token

Issued by `POST /api/voice/session` (`apps/web/src/lib/server/voice-token.ts`),
verified by the gateway (`services/voice-gateway/src/lib/token.ts`) using the
`jose` library and a shared secret (`VOICE_GATEWAY_SIGNING_SECRET`, identical
on both sides — never sent to the browser). Claims
(`packages/shared`'s `VoiceSessionTokenClaimsSchema`):

```
{ sub, sessionId, scenarioId, maxAllowedSeconds, iat, exp, jti }
```

- **TTL**: 180 seconds (`VOICE_TOKEN_TTL_SECONDS`) — just enough time to open
  the WebSocket connection, not a session-length credential.
- **No secrets, no hidden state**: never carries the Gemini key, the
  Supabase service-role key, or a scenario's `hidden_state`/persona
  details.
- **`maxAllowedSeconds` is signed, not client-suppliable**: the browser
  receives this value in the `POST /api/voice/session` response purely for
  display; it has no way to open a WebSocket with a *different* value,
  because doing so would require forging a valid HMAC signature. Verified:
  a token with `maxAllowedSeconds` altered post-signing fails verification
  (`services/voice-gateway/src/lib/token.test.ts`).
- **The token alone does not authorize spending.** It only proves "the web
  server recently authorized this call for this user." The gateway still
  re-validates the *live* database row (ownership, scenario match, state)
  before doing anything billable — see `evaluateSessionEligibility()`
  (`services/voice-gateway/src/lib/session-eligibility.ts`).

### Why the gateway's timer is authoritative, not the browser's

The browser runs its own per-second countdown purely for UX smoothness
between the gateway's periodic `quota` events — it is presentation state
only and is never sent back to any server as a duration. All billable time
comes from `CallSessionRuntime` (`services/voice-gateway/src/
session-runtime.ts`), which:

- Uses `process.hrtime.bigint()` (a monotonic clock, immune to system-clock
  adjustments) to timestamp the moment the call becomes `active`.
- Computes `durationSeconds = ceil(elapsedMs / 1000)` when the call ends,
  for any reason (explicit `end`, disconnect, quota cutoff, provider
  error) — any nonzero active time bills at least 1 second; truly zero
  elapsed active time bills zero.
- Passes that duration — and *only* that duration — to
  `finalizeCallUsage()`, which calls the same `finalize_call_usage()`
  Postgres RPC from Phase 2 directly, using the gateway's own service-role
  credentials. The client-to-gateway message schema (`ClientToGatewayMessageSchema`)
  has no field for a duration at all, so there's structurally nothing for a
  client to submit.
- Is guarded so finalization runs at most once per connection no matter
  which of {explicit `end`, socket close, quota cutoff, provider error} is
  first to trigger it — backed by the same database-level idempotency
  (`usage_finalized_at`, the unique `idempotency_key`) verified in Phase 2.

As of Phase 3, the **web app no longer exposes any HTTP endpoint that lets
the browser submit a duration for billing** — the Phase 2
`POST /api/voice/session/:id/finalize` development endpoint was removed
once the gateway became the authoritative timer.

### Quota enforcement

`effectiveMaxSeconds = min(token.maxAllowedSeconds, gateway's own
MAX_CALL_SECONDS)` — the gateway applies its own independent ceiling
(`MAX_CALL_SECONDS` env var, default 1800s) regardless of what a token
claims, as a defense-in-depth safety cap. A `setTimeout` fires exactly at
that cutoff to end the call (`{type:"quota_exhausted"}` then finalize);
a separate `setInterval` (every 15s) sends `{type:"quota", remainingSeconds}`
purely for the browser's display.

### Call lifecycle & disconnect handling

```
authorized -> connecting -> active -> ending -> completed
authorized -> connecting -> failed                          (provider never connected)
```

- **Provider fails before `active`**: no billable time ever existed, so the
  session is marked `failed` directly (no ledger interaction at all) rather
  than finalized with a zero duration.
- **Abrupt disconnect while `active`**: finalizes whatever active time
  actually elapsed, exactly like an explicit `end` — the session becomes
  `completed`.
- **Gateway process crash**: not handled in Phase 3. A session stuck in
  `connecting`/`active` in the database with no live gateway process
  watching it is a known limitation; a stale-session sweep/recovery job is
  deferred to Phase 7 (production hardening).

### Reconnect policy

One token authorizes exactly one initial connection attempt for one
session. The gateway tracks in-process which `call_sessions` currently have
a live connection (`activeSessionIds` in `app.ts`) and rejects a second
connection outright; a session that has already reached `completed` or
`failed` can never restart, enforced by `evaluateSessionEligibility()`
requiring `state === 'authorized'`. This is intentionally the simplest safe
policy — no reconnect grace period. The in-process tracking is
single-instance only; see `docs/DEPLOYMENT.md` for the multi-instance
caveat.

### How Phase 4 (Gemini Live) plugs in

Everything above is provider-agnostic: `CallSessionRuntime` talks to
whatever `VoiceProvider` `createProvider()` returns
(`services/voice-gateway/src/providers/voice-provider.ts`), and
`GeminiLiveProvider` already implements that same interface (currently a
stub that throws — see `docs/CLAUDE_CODE_PLAN.md`). Swapping
`VOICE_PROVIDER=gemini` will route calls through it without changing
token issuance, session-eligibility checks, timing, quota enforcement, or
finalization — the free-plan entitlement architecture does not need to
change for Phase 4.
