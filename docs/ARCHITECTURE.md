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
- billing UI
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

## Entitlement (Phase 2)
All usage/credit logic lives server-side, split across two layers:

- `apps/web/src/lib/server/entitlement.ts` — server-only module (never
  imported by client components) using a service-role Supabase client that
  bypasses RLS. Exposes `getEntitlement`, `authorizeCallSession`, and
  `finalizeCallUsage`.
- `supabase/migrations/003_entitlement_foundation.sql` — the
  `finalize_call_usage` Postgres function, which is the *only* code path
  that ever debits paid credits. It runs the balance computation and the
  ledger write inside one atomic, locked transaction, and only the
  `service_role` Postgres role may execute it (`authenticated`/`anon` are
  explicitly revoked).

API surface:
- `GET /api/entitlement` — authenticated user's current free/paid balance.
- `POST /api/voice/session` — authorizes a call (validates scenario +
  entitlement, creates an `authorized` call_sessions row, returns
  `maxAllowedSeconds`). Does not yet issue a signed gateway token or
  connect to a voice provider — that's Phase 3.
- `POST /api/voice/session/:id/finalize` — development-safe finalize
  endpoint for the Phase 2 mock call flow; the browser's own timer supplies
  a *claimed* duration that the server clamps against trusted timestamps
  before charging anything. Phase 3's voice gateway will call the same
  underlying `finalizeCallUsage` with server-metered duration instead.

See `docs/MONETIZATION.md` for the allowance/ledger/rounding rules and
`docs/SECURITY.md` for what's locked down and why.
