# Claude Code Build Plan

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
- quota cutoff enforced server-side at
  `min(token.maxAllowedSeconds, gateway's MAX_CALL_SECONDS)`, with periodic
  `quota` events for the UI
- disconnect handling: abrupt close while active still finalizes correctly
  exactly once; pre-active close/failure marks the session `failed` with
  zero usage
- gateway calls `finalize_call_usage()` directly with its own service-role
  credentials — the browser can no longer submit a duration anywhere (the
  Phase 2 dev-mode finalize endpoint was removed)
- 37 gateway tests (unit + a real Fastify+WebSocket E2E test) plus updated
  shared-schema tests; see the Phase 3 development report for exactly what
  was and wasn't run against a live Supabase project

## Phase 4 — Gemini Live
- implement current official Gemini Live transport
- real-time two-way audio
- interruption/barge-in
- graceful provider failure
- no API key in browser

## Phase 5 — Coaching
- transcript/events
- deterministic metrics
- post-call evaluator
- report UI

## Phase 6 — Stripe
- checkout
- webhook
- idempotent credit grant
- billing history

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
