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

## Phase 3 — Mock voice gateway
- signed voice token issued by `POST /api/voice/session` (currently returns
  session metadata only; add the signed gateway token here)
- WebSocket lifecycle wired to the real authorize/finalize endpoints from
  Phase 2 instead of the browser's own timer
- disconnect handling
- quota cutoff enforced by the gateway using `maxAllowedSeconds`

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
