# Claude Code Build Plan

## Architecture update: accounts and Supabase removed
Cold Call Gym no longer has accounts, passwords, or a database. Supabase (auth + Postgres) has
been removed from the active architecture entirely — the old migrations are archived at
`legacy/supabase/` as a historical record only. Access is now lead-gated: submitting name + email
+ phone at `/start` immediately grants access via an opaque session cookie (access gating, not
authentication — see `docs/SECURITY.md`). Storage is a pluggable, currently in-memory
abstraction (`apps/web/src/lib/server/store/`), explicitly documented as non-durable until a real
datastore is chosen (see `docs/DEPLOYMENT.md`'s "Production persistence"). The voice gateway is
unchanged in spirit — still the authoritative timer/quota enforcer — but now reaches the web app's
session state over a small internal HTTP API instead of a shared Postgres connection (see
`docs/ARCHITECTURE.md`). Every bullet below that mentions Supabase, `call_sessions`,
signup/login, or a Postgres RPC describes what was built AT THE TIME, not current behavior — see
`docs/ARCHITECTURE.md`, `docs/SECURITY.md`, and `docs/MONETIZATION.md` for what's actually running
now.

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
