# Claude Code Build Plan

## Architecture update: accounts and Supabase removed
Cold Call Gym no longer has accounts or a relational database. Supabase (auth + Postgres) has
been removed from the active architecture entirely — the old migrations are archived at
`legacy/supabase/` as a historical record only. Access is now lead-gated: submitting name + email
+ phone at `/start` immediately grants access via an opaque session cookie (access gating, not
authentication — see `docs/SECURITY.md`). Storage is a pluggable abstraction
(`apps/web/src/lib/server/store/`) — see "Storage update: durable Redis backend added" below for
what actually backs it now. The voice gateway is unchanged in spirit — still the authoritative
timer — but now reaches the web app's session state over a small internal HTTP API
instead of a shared Postgres connection (see `docs/ARCHITECTURE.md`). Every bullet below that
mentions Supabase, `call_sessions`, signup/login, or a Postgres RPC describes what was built AT
THE TIME, not current behavior — see `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, and
`docs/MONETIZATION.md` for what's actually running now.

## Storage update: durable Redis backend added
The in-memory-only storage from the "Architecture update" above turned out to break the app in
real production use on Vercel: serverless functions don't share process memory between requests,
so a lead created by `/start` could be invisible on the very next request. Fixed by adding an
Upstash Redis-backed implementation (`apps/web/src/lib/server/store/redis-store.ts` +
`redis-lock.ts` for the distributed lock `finalizeUsage()` needs once atomicity can't come for
free from single-process synchronous execution) — `index.ts` selects it automatically whenever
`UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` are set, falling back to the original
in-memory store otherwise (so local dev still needs zero external setup). `GET /api/health`
reports which backend is active. This is a deliberate, minimal addition behind the exact same
`LeadStore`/`CallSessionStore`/`SalesInquiryStore` interfaces — not a new architecture, not a
relational database, not accounts. See `docs/ARCHITECTURE.md`'s "Storage abstraction" and
`docs/DEPLOYMENT.md`'s "Production persistence".

## Business model update (post-Phase 3)
Cold Call Gym's MVP business model changed to **free plan only, no
self-service payments**: a single 10-minute/UTC-day free allowance per
user, no purchased credits, no subscriptions, no Stripe. Teams needing more
use Contact Sales (`/contact-sales`). This retired the paid-credit work
described under Phase 2 below (see
`legacy/supabase/migrations/004_free_plan_entitlement.sql`) and removed Phase 6
(Stripe) from this plan entirely — see `docs/MONETIZATION.md` for the
current model. The Phase 2/3 bullets below are left as an accurate record
of what was actually built at the time, not a description of current
behavior.

## Business model update: unlimited practice time
The 10-minute/UTC-day free allowance described in "Business model update (post-Phase 3)" below
has itself been retired. Cold Call Gym's practice time is now **free and unlimited** — no daily
allowance, no per-call ceiling (`MAX_CALL_SECONDS` was removed first; the daily allowance was
removed after it). `getEntitlement()`/`FreeEntitlementSchema` became
`getPracticeStats()`/`PracticeStatsSchema` (purely informational — `GET /api/practice-stats`,
formerly `GET /api/entitlement`), `computeMaxAllowedSeconds()` and `DAILY_FREE_SECONDS` were
removed from `packages/shared`, and the voice gateway's quota timer/events were removed
entirely — see `docs/MONETIZATION.md` and `docs/ARCHITECTURE.md` for the current model. The
Phase 2/3 bullets below (and the "Business model update (post-Phase 3)" section) are left as an
accurate record of what was built at the time, not current behavior.

## Phase 1 — Foundation ✅ complete
- monorepo installs/builds
- Supabase auth
- dashboard
- scenario list/detail
- migrations + seed
- tests

## Phase 2 — Entitlement ✅ complete
- daily allowance (600s/day, UTC boundary, no reset job — see docs/MONETIZATION.md)
- immutable credit ledger (`finalize_call_usage` Postgres RPC, atomic + idempotent)
- entitlement API (`GET /api/entitlement`)
- call authorization foundation (`POST /api/voice/session`)
- usage finalization (`POST /api/voice/session/[id]/finalize`)
- one-time welcome credits (5, granted via signup trigger)
- edge-case tests (client-math unit tests + live-Postgres integration script)

## Phase 3 — Mock voice gateway ✅ complete
- signed, short-lived voice-session JWT issued by `POST /api/voice/session`
  (`VOICE_GATEWAY_SIGNING_SECRET`, 180s TTL)
- gateway verifies the token, then re-validates the live `call_sessions`
  row (ownership, scenario, state) before starting anything
- full WebSocket lifecycle: authorized -> connecting -> active -> ending ->
  completed, with a `failed` branch for pre-active provider failures
- gateway-authoritative monotonic timer (`process.hrtime.bigint()`); the
  browser's own countdown is presentation-only
- quota cutoff enforced server-side at `token.maxAllowedSeconds` (no
  separate gateway-side ceiling), with periodic `quota` events for the UI
- disconnect handling: abrupt close while active still finalizes correctly
  exactly once; pre-active close/failure marks the session `failed` with
  zero usage
- gateway calls `finalize_call_usage()` directly with its own service-role
  credentials — the browser can no longer submit a duration anywhere (the
  Phase 2 dev-mode finalize endpoint was removed)
- 37 gateway tests (unit + a real Fastify+WebSocket E2E test) plus updated
  shared-schema tests; see the Phase 3 development report for exactly what
  was and wasn't run against a live Supabase project

## Phase 4 — Gemini Live ✅ complete
- real `GeminiLiveProvider` against the official `@google/genai` SDK's Live API
  (`services/voice-gateway/src/providers/gemini-live-provider.ts`), selected via
  `VOICE_PROVIDER=gemini`; `VOICE_PROVIDER=mock` (default) keeps the deterministic mock provider
  for CI/local dev
- real-time two-way native audio: browser mic (resampled to 16kHz PCM16) → gateway → Gemini Live →
  24kHz PCM16 response → gateway → browser speaker, via a real `AudioWorkletNode` capture pipeline
  and Web Audio API scheduled playback (`apps/web/src/lib/audio/{pcm,mic-capture,playback}.ts`)
- interruption/barge-in via Gemini's own automatic voice-activity detection — no client-side
  "press stop" interaction; the browser clears queued playback immediately on `interrupted`
- persona-driven system instructions built per scenario (`buildPersonaSystemInstruction()`,
  `packages/shared/src/index.ts`) — Gemini plays the prospect, never a coach/assistant
- graceful provider failure: readiness (billing-timer start) gated on Gemini's `setupComplete`,
  never merely a WebSocket open; failures classified into a safe code taxonomy
  (`services/voice-gateway/src/lib/gemini-error.ts`) and never leak raw provider errors or the API
  key to the browser
- `GEMINI_API_KEY` read only on the gateway process; gateway refuses to start with
  `VOICE_PROVIDER=gemini` and no key configured (`services/voice-gateway/src/lib/config.ts`)
- input/output transcription enabled for UI/debugging, not required for the call to function
- see `docs/ARCHITECTURE.md`'s "Voice provider (Phase 4: real Gemini Live)" section for the full
  pipeline and `docs/SECURITY.md` for the trust-boundary details

## Phase 5 — Coaching
- transcript/events
- deterministic metrics
- post-call evaluator
- report UI

## Phase 6 — retired (no self-service payments)
Cold Call Gym's MVP has no Stripe integration, purchased credits, or
subscriptions — see "Business model update" at the top of this file and
`docs/MONETIZATION.md`. Expanded access is handled entirely through
Contact Sales, already implemented (see `POST /api/contact-sales`, `/contact-sales`; the sales
inquiry storage described here as a Postgres table has since moved to the in-memory
`SalesInquiryStore` — see "Architecture update" at the top of this file).

## Phase 7 — Production hardening
- logging
- rate limiting
- CI/CD
- security review
- deployment

## First Claude Code prompt
Read README.md, CLAUDE.md, docs/PRD.md, docs/ARCHITECTURE.md, and the full repo.
Implement Phase 1 only.
Make install, typecheck, test, and build pass.
Do not implement real Gemini or Stripe calls yet.
Keep mock voice mode working.
At the end report files changed, commands run, tests, and remaining Phase 1 items.
