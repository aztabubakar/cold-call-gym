# Architecture

Browser ↔ Next.js web app ↔ in-memory storage abstraction
              |         ↑
              |         | internal session API (HTTP, shared-secret auth)
              └── signed voice session token
                       |
                       v
                Voice Gateway
                       |
                       v
                 Gemini Live

Cold Call Gym has no accounts and no database. The web app and the voice gateway are still two
separate services/processes — that split from earlier phases is unchanged — but with Supabase
removed there is no longer a shared Postgres instance for both to talk to directly. The web app
owns the storage abstraction (leads, call sessions, sales inquiries — see "Storage abstraction"
below) and remains the single source of truth; the voice gateway reaches it over a small internal
HTTP API instead of a database connection. See "Storage abstraction" and "Voice session lifecycle"
below for exactly how that works.

## Web responsibilities
- the `/start` access form (name + email + phone → opaque access-session cookie — see
  `docs/SECURITY.md`; this is access gating, not authentication)
- dashboard
- scenarios
- contact sales UI (the only path to expanded access — no billing UI, no
  self-service payments; see docs/MONETIZATION.md)
- call history
- coaching report UI
- create short-lived voice authorization
- own the storage abstraction and serve it to the voice gateway over the internal session API

## Voice gateway responsibilities
- validate the access session/token
- load scenario/persona
- check entitlement
- connect to Gemini Live
- relay audio
- meter time server-side
- terminate when quota is exhausted
- finalize usage (via the web app's internal session API)
- write session outcome (ditto)

## Call states
created → authorized → connecting → active → ending → completed
                                              ↘ failed

## Why separate voice gateway?
Real-time audio is long-lived and stateful. A dedicated gateway is easier to operate than a short-lived serverless handler.

## Storage abstraction

Cold Call Gym has no database. `apps/web/src/lib/server/store/` defines the interfaces
(`LeadStore`, `CallSessionStore`, `SalesInquiryStore` — see `types.ts`) that all application code
depends on, and a single in-memory implementation of them (`memory-store.ts`) that everything
currently resolves to (`index.ts`).

**This implementation is explicitly not durable and not multi-instance-safe** — state lives in a
plain module-level `Map` and is lost on every process restart, and is not shared across more than
one running instance of the web app. Within a single process it IS genuinely atomic (every store
method runs synchronously to completion, so JavaScript's single-threaded execution model
reproduces the old Postgres row-lock/advisory-lock guarantees — see `memory-store.ts`'s doc
comment and `apps/web/src/lib/server/store/usage-math.ts` for the entitlement math this relies
on). See `docs/DEPLOYMENT.md`'s "Production persistence" section for what replacing this with a
real datastore requires — it means writing a new module against the same interfaces in `types.ts`
and changing what `index.ts` exports, with no changes anywhere else in the app.

The interfaces are deliberately agnostic about *how* an access identity came to be trusted, so a
stronger verification step (email OTP, phone verification) could be layered in later — at `/start`
or as an additional gate before `/call` — without redesigning `LeadStore`, `CallSessionStore`, or
anything in the voice gateway.

## Entitlement (free plan only)
Cold Call Gym has no paid credits (see `docs/MONETIZATION.md`) — every access identity gets a
single free daily allowance (600 seconds/UTC day, no rollover). All entitlement logic lives
server-side, split across two layers:

- `apps/web/src/lib/server/entitlement.ts` — server-only module using the `CallSessionStore`
  directly (no network hop needed — it runs in the same process as the store). Exposes
  `getEntitlement` and `authorizeCallSession`, both keyed by `accessId` (a lead's opaque id — see
  `docs/SECURITY.md`).
- `apps/web/src/lib/server/store/memory-store.ts`'s `finalizeUsage()` — the *only* code path that
  ever records billable usage. It runs the calculation synchronously against the in-memory store
  (see "Storage abstraction" above for what that does and doesn't guarantee).

API surface:
- `GET /api/entitlement` — the current access identity's free-plan entitlement (`{ plan,
  dailyLimitSeconds, usedTodaySeconds, remainingTodaySeconds, canStartCall, resetsAt }`). 401 if
  there's no valid access session.
- `POST /api/voice/session` — authorizes a call (validates scenario + entitlement, creates an
  `authorized` call-session record, signs a short-lived voice-gateway token, returns
  `maxAllowedSeconds`).
- `POST /api/access` — public. Submits the `/start` form; creates a lead and sets the access
  cookie. See `docs/SECURITY.md`.
- `POST /api/contact-sales` — public. Records a sales inquiry.
- `GET|POST /api/internal/sessions/[id]` — **internal only**, gated by a shared secret
  (`INTERNAL_API_KEY`), never called by the browser. This is what the voice gateway uses instead
  of a database connection — see "Voice session lifecycle" below.
- There is no other browser-callable finalize endpoint. The voice gateway is the only caller of
  `finalizeUsage()` (via the internal session API), using its own server-side metered duration —
  never the browser's.

See `docs/MONETIZATION.md` for the allowance/rounding rules and `docs/SECURITY.md` for what's
locked down and why.

## Voice session lifecycle

```
Browser                    Next.js web app              Voice Gateway      Internal session API
   |  POST /api/voice/session   |                            |                    |
   |--------------------------->| validate access session +  |                    |
   |                            | scenario + entitlement,     |                    |
   |                            | create call-session record  |--------------------|
   |                            | sign short-lived JWT        |                    |
   |<---------------------------| {sessionId, gatewayUrl,     |                    |
   |                            |  token, maxAllowedSeconds}  |                    |
   |  wss://gateway/ws?token=…                                |                    |
   |----------------------------------------------------------->| verify JWT sig+exp |
   |                                                            | GET session state ->|
   |                                                            | verify ownership +  |
   |                                                            | eligibility <--------|
   |                                                            | authorized->connecting (POST)|
   |                                                            | connect mock provider |
   |<----------------------------------------------------------| {type:"connected"}  |
   |<----------------------------------------------------------| {type:"active", …}  | connecting->active (POST),
   |                                                            | start monotonic timer|
   |<----------------------------------------------------------| {type:"quota", …}   | (every ~15s)
   |  {type:"end"}  ------------------------------------------->|                     |
   |                                                            | stop timer, close    |
   |                                                            | provider,            |
   |                                                            | POST …/finalize ---->| atomic finalize
   |<----------------------------------------------------------| {type:"completed", …}| (in-process, synchronous)
```

The gateway calls the internal session API (`apps/web/src/app/api/internal/sessions/[id]/route.ts`,
client in `services/voice-gateway/src/lib/{session-store,entitlement}.ts`) with a bearer token
(`INTERNAL_API_KEY`, shared between the two services, never exposed to the browser) for every one
of these steps. This is the direct replacement for "both processes connect to the same Postgres
database with service-role credentials" from the earlier Supabase-backed architecture — the web
app is still the sole source of truth for session state and the sole place `finalizeUsage()` runs;
only the transport changed.

### The signed voice-session token

Issued by `POST /api/voice/session` (`apps/web/src/lib/server/voice-token.ts`),
verified by the gateway (`services/voice-gateway/src/lib/token.ts`) using the
`jose` library and a shared secret (`VOICE_GATEWAY_SIGNING_SECRET`, identical
on both sides — never sent to the browser). Claims
(`packages/shared`'s `VoiceSessionTokenClaimsSchema`):

```
{ sub, sessionId, scenarioId, maxAllowedSeconds, iat, exp, jti }
```

- **`sub` is the lead's opaque access identifier**, never their name, email, or phone. Cold Call
  Gym has no accounts, so there is no "user id" here in an authentication sense — it identifies
  which access session (and therefore which daily allowance) the call counts against. See
  `docs/SECURITY.md`.
- **TTL**: 180 seconds (`VOICE_TOKEN_TTL_SECONDS`) — just enough time to open
  the WebSocket connection, not a session-length credential.
- **No secrets, no hidden state**: never carries the Gemini key, `INTERNAL_API_KEY`,
  or a scenario's `hidden_state`/persona details.
- **`maxAllowedSeconds` is signed, not client-suppliable**: the browser
  receives this value in the `POST /api/voice/session` response purely for
  display; it has no way to open a WebSocket with a *different* value,
  because doing so would require forging a valid HMAC signature. Verified:
  a token with `maxAllowedSeconds` altered post-signing fails verification
  (`services/voice-gateway/src/lib/token.test.ts`).
- **The token alone does not authorize spending.** It only proves "the web
  server recently authorized this call for this access identity." The gateway still
  re-validates the *live* session state (over the internal session API) — see
  `evaluateSessionEligibility()`
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
  `finalizeCallUsage()`, which calls the web app's internal session API's finalize action, using
  the gateway's own `INTERNAL_API_KEY` credential. The client-to-gateway message schema
  (`ClientToGatewayMessageSchema`) has no field for a duration at all, so there's structurally
  nothing for a client to submit.
- Is guarded so finalization runs at most once per connection no matter
  which of {explicit `end`, socket close, quota cutoff, provider error} is
  first to trigger it — backed by the same idempotency guarantee
  (`usageFinalizedAt`, an idempotency key) on the web app's store.

The web app **never exposes any HTTP endpoint that lets the browser submit a
duration for billing** — only the gateway can call the internal session API, and only with
`INTERNAL_API_KEY`.

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
  session is marked `failed` directly (no finalize call at all) rather
  than finalized with a zero duration.
- **Abrupt disconnect while `active`**: finalizes whatever active time
  actually elapsed, exactly like an explicit `end` — the session becomes
  `completed`.
- **Gateway process crash**: not handled. A session stuck in
  `connecting`/`active` with no live gateway process watching it is a known
  limitation; a stale-session sweep/recovery job is deferred to production
  hardening.
- **Web app unreachable from the gateway**: if the internal session API call fails (network error,
  web app down), the gateway's finalize attempt throws and the call is not marked completed — a
  known limitation of the HTTP-based split versus a database connection with its own retry/queue
  semantics; not solved here.

### Reconnect policy

One token authorizes exactly one initial connection attempt for one
session. The gateway tracks in-process which sessions currently have
a live connection (`activeSessionIds` in `app.ts`) and rejects a second
connection outright; a session that has already reached `completed` or
`failed` can never restart, enforced by `evaluateSessionEligibility()`
requiring `state === 'authorized'`. This is intentionally the simplest safe
policy — no reconnect grace period. The in-process tracking is
single-instance only; see `docs/DEPLOYMENT.md` for the multi-instance
caveat (which now also applies to the in-memory store itself, not just this tracking set).

### How Phase 4 (Gemini Live) plugs in

Everything above is provider-agnostic: `CallSessionRuntime` talks to
whatever `VoiceProvider` `createProvider()` returns
(`services/voice-gateway/src/providers/voice-provider.ts`), and
`GeminiLiveProvider` already implements that same interface (currently a
stub that throws — see `docs/CLAUDE_CODE_PLAN.md`). Swapping
`VOICE_PROVIDER=gemini` will route calls through it without changing
token issuance, session-eligibility checks, timing, quota enforcement, or
finalization — the storage/entitlement architecture does not need to
change for Phase 4.
