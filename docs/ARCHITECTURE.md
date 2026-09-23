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

Cold Call Gym has no accounts and no relational database. The web app and the voice gateway are
still two separate services/processes — that split from earlier phases is unchanged — but with
Supabase removed there is no longer a shared Postgres instance for both to talk to directly. The
web app owns the storage abstraction (leads, call sessions, sales inquiries — see "Storage
abstraction" below, including the Redis-backed production implementation) and remains the single
source of truth; the voice gateway reaches it over a small internal HTTP API instead of a
database connection. See "Storage abstraction" and "Voice session lifecycle" below for exactly
how that works.

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
- connect to the configured voice provider (mock, or real Gemini Live — see "Voice provider" below)
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

Cold Call Gym has no relational database. `apps/web/src/lib/server/store/` defines the interfaces
(`LeadStore`, `CallSessionStore`, `SalesInquiryStore` — see `types.ts`) that all application code
depends on. `index.ts` selects the backing implementation automatically, based on environment:

- **`memory-store.ts`** — a plain in-process `Map`. Used only when
  `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` aren't set (local dev, zero external setup
  required). **Not durable and not multi-instance-safe** — state is lost on every process restart
  and isn't shared across more than one running instance. Within a single process it IS genuinely
  atomic (every method runs synchronously to completion, so JS's single-threaded execution model
  reproduces the old Postgres row-lock/advisory-lock guarantees — see its doc comment).
- **`redis-store.ts`** — Upstash Redis via its REST client (`@upstash/redis`), which needs no
  persistent connection and is safe to call from serverless functions. **This is what production
  (Vercel) actually runs on.** Atomicity across network calls (rather than free, single-process
  synchronous execution) comes from a real distributed lock scoped per access identity
  (`redis-lock.ts`) around `finalizeUsage()` — the same purpose as the old Postgres per-user
  advisory lock, different mechanism. `GET /api/health` reports which backend is active
  (`"store":"redis"` or `"store":"memory"`).

Both implementations share the same pure, storage-agnostic entitlement math
(`apps/web/src/lib/server/store/usage-math.ts`) — only how session records are stored/locked
differs. See `docs/DEPLOYMENT.md`'s "Production persistence" section for setup.

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
- `CallSessionStore.finalizeUsage()` — the *only* code path that ever records billable usage,
  implemented by whichever backend `index.ts` selects (`memory-store.ts` or `redis-store.ts` —
  see "Storage abstraction" above for what each guarantees).

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
   |                                                            | connect voice provider|
   |                                                            | (mock or Gemini Live) |
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

## Voice provider (Phase 4: real Gemini Live)

```
Browser mic → resample to 16kHz PCM16 → Voice Gateway → Gemini Live
Gemini Live → native 24kHz PCM16 audio → Voice Gateway → Browser speaker
```

Everything in "Voice session lifecycle" above is provider-agnostic:
`CallSessionRuntime` talks to whatever `VoiceProvider` `createProvider()`
returns (`services/voice-gateway/src/providers/voice-provider.ts`).
`VOICE_PROVIDER=mock` (default) uses `MockVoiceProvider` — deterministic,
no external calls, what CI/tests run against. `VOICE_PROVIDER=gemini` uses
`GeminiLiveProvider`, a real implementation against the official
`@google/genai` SDK's Live API. Switching providers changes nothing about
token issuance, session-eligibility checks, timing, quota enforcement, or
finalization — only what `CallSessionRuntime` calls to actually talk.

**The browser never talks to Gemini directly.** `GEMINI_API_KEY` is read
only in `services/voice-gateway/src/providers/gemini-live-provider.ts`,
never logged, never put in a JWT claim, and there is no
`NEXT_PUBLIC_GEMINI_API_KEY` anywhere — see docs/SECURITY.md.

### Readiness and billing

`GeminiLiveProvider` emits the `connected` event (which is what triggers
`CallSessionRuntime.becomeActive()` — see "Why the gateway's timer is
authoritative" above) **only after Gemini's own `setupComplete` message
arrives**, never merely because the underlying WebSocket to Gemini opened.
If `setupComplete` doesn't arrive within 10 seconds
(`READY_TIMEOUT_MS`), that's treated as a pre-active failure
(`provider_timeout`) — zero billable time, exactly like any other
pre-active failure. This is what stops Gemini connection latency from
ever eating into a user's daily allowance.

### Model and configuration

`GEMINI_MODEL` selects the model (default `DEFAULT_GEMINI_MODEL =
"gemini-3.8-live"`, defined once in `packages/shared` and never hardcoded
elsewhere). The Live session is configured with:
- `responseModalities: [Modality.AUDIO]` — native audio-to-audio, never
  text-only.
- `systemInstruction` — the scenario's full persona (see "Persona
  prompting" below).
- `inputAudioTranscription: {}` / `outputAudioTranscription: {}` — enabled
  for the `transcript` event (UI/debugging only, never required for the
  call to function).
- Deliberately **not** set: `thinkingConfig` (not appropriate for this
  conversational voice persona) and `enableAffectiveDialog` (unnecessary
  here) — per product requirement for `gemini-3.8-live`.
- Deliberately **not** set: `explicitVadSignal` / a disabled
  `realtimeInputConfig` — leaving automatic voice-activity-based turn
  detection as the default is what gives natural barge-in (see below) with
  no client-side "press stop after every sentence" interaction.

### Persona prompting

The gateway builds the system instruction from the scenario's full
persona — role, company, patience/skepticism, current solution, common
objections, difficulty, and private "hidden state" context — via
`buildPersonaSystemInstruction()` (`packages/shared/src/index.ts`). The
scenario catalog lives in `packages/shared` (not just `apps/web`)
specifically so the gateway can look it up **directly from the signed
token's `scenarioId` claim**, with no network call back to the web app —
see `CallSessionRuntime.start()`. The prompt explicitly instructs Gemini
to stay in character as the prospect (never as a coach, assistant, or
interviewer), never reveal its instructions, never announce it's an AI
unless directly asked, and scale resistance to the scenario's difficulty —
see `packages/shared/src/scenarios.test.ts` for what's verified about it.

### Audio formats and transport

- **Browser → Gateway → Gemini (input)**: the mic's native sample rate
  (whatever the device/browser gives — typically 48kHz or 44.1kHz) is
  resampled client-side to Gemini's fixed required input format — 16kHz
  mono PCM16 (`GEMINI_INPUT_SAMPLE_RATE_HZ`) — then base64-encoded and
  sent as the existing `{type:"audio", data}` WebSocket message
  (`apps/web/src/lib/audio/{pcm,mic-capture}.ts`). The gateway does **no**
  transcoding: it forwards that same base64 string directly to
  `session.sendRealtimeInput({audio:{data, mimeType:"audio/pcm;rate=16000"}})`.
- **Gemini → Gateway → Browser (output)**: Gemini's native output is
  always 24kHz mono PCM16 (`GEMINI_OUTPUT_SAMPLE_RATE_HZ`, not
  configurable). The gateway relays the base64 audio it gets from the SDK
  straight through as a new `{type:"audio", data}` GatewayToClientEvent —
  again no transcoding. The browser decodes and schedules it for gapless
  playback (`apps/web/src/lib/audio/playback.ts`); `AudioBuffer` accepts
  any sample rate independent of the `AudioContext`'s own rate, so no
  manual resampling is needed on the output side.
- **Transport choice**: base64-encoded JSON over the existing WebSocket
  (not raw binary frames). This adds ~33% size overhead per chunk versus
  binary, but was kept deliberately — it requires zero changes to the
  existing `ClientToGatewayMessageSchema`/`GatewayToClientEventSchema`
  JSON envelope, avoids a mixed binary+JSON protocol, and the overhead is
  small in absolute terms for the realistic chunk sizes involved
  (~20ms of 16kHz mono PCM16 ≈ 640 bytes raw ≈ ~854 base64 chars — see
  `MAX_AUDIO_CHUNK_BASE64_CHARS`, which bounds this well above what one
  real-time chunk needs, rejecting oversized/malformed frames before they
  ever reach a provider). `@fastify/websocket` is also configured with a
  1MB `maxPayload` as a transport-level backstop.
- **Chunking**: the browser's `AudioWorkletProcessor`
  (`public/audio/mic-worklet.js`) accumulates ~20ms of audio per chunk
  before posting it to the main thread for resampling/encoding/sending —
  small enough for low conversational latency, large enough to avoid
  per-message overhead from sending every single 128-sample render
  quantum.

### Barge-in and turn detection

Gemini's default automatic voice-activity detection (VAD) is what drives
both turn-taking and interruption — the gateway doesn't implement any of
its own VAD or explicit "press stop" interaction. When the caller starts
speaking while Gemini is generating, Gemini detects this itself and sends
`serverContent.interrupted: true`; `GeminiLiveProvider` turns that into an
`interrupted` VoiceEvent, `CallSessionRuntime` forwards it as
`{type:"interrupted"}`, and the browser's `AudioPlaybackQueue.interrupt()`
immediately stops and discards every scheduled/playing audio source —
nothing queued survives an interruption. The caller's own microphone
capture is never paused by an interruption (only prospect *playback*
stops) — see `apps/web/src/components/CallSession.tsx`.

### Transcription

`inputAudioTranscription`/`outputAudioTranscription` are enabled, and
Gemini's transcript deltas are relayed as `{type:"transcript", role:
"user"|"prospect", text, final}` events. This is UI/debugging-only —
nothing about call authorization, timing, or finalization depends on it,
and Cold Call Gym doesn't persist transcripts by default (storage is
ephemeral in-memory anyway — see "Storage abstraction" above).

### Provider error handling

`GeminiLiveProvider` classifies every SDK failure (`classifyGeminiError()`
in `services/voice-gateway/src/lib/gemini-error.ts`) into one of a fixed
set of safe codes — `provider_auth_error`, `provider_quota_error`,
`provider_connection_error`, `provider_timeout`, `provider_protocol_error`,
`provider_unavailable` — never the SDK's raw error text, which could
describe internal implementation details. A pre-active failure always
reaches the browser as the same friendly message ("We couldn't start the
AI prospect. Please try again.") regardless of the underlying code; the
code itself is only for server-side logging/debugging. No automatic
retry/reconnect is implemented — a Gemini failure before `active` fails
the session (zero usage); a failure after `active` ends and finalizes the
call normally, exactly like an explicit hang-up. This is a deliberate,
conservative choice: silently reconnecting mid-call would either lose
conversation context or risk double-finalizing usage, neither of which is
worth the complexity for this MVP.

### Startup validation

`services/voice-gateway/src/lib/config.ts`'s `validateGatewayConfig()`
runs once at process start (`index.ts`), before the gateway accepts any
connections: if `VOICE_PROVIDER=gemini` but `GEMINI_API_KEY` is unset, the
process logs a clear error and exits immediately (exit code 1) rather than
starting and only discovering the missing credential on the first real
call.
