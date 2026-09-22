# Cold Call Gym

Voice-first AI sales practice SaaS.

## Core loop
Choose scenario → call AI prospect → handle objections → end call → receive coaching → practice again.

## Status: Phase 2 complete (usage entitlement + credit ledger)
- Phase 1: auth shell, dashboard, scenario browsing/detail, mock call UI,
  Supabase foundation — see git history for details.
- Phase 2: server-authoritative entitlement (10 free min/day, UTC boundary,
  no reset job), immutable credit ledger, atomic + idempotent usage
  finalization (`finalize_call_usage` Postgres RPC with per-user advisory
  locking), one-time welcome credits, `GET /api/entitlement`,
  `POST /api/voice/session` (call authorization), and
  `POST /api/voice/session/:id/finalize`. Dashboard and call pages now show
  real server-computed balances. See `docs/MONETIZATION.md` and
  `docs/SECURITY.md` for the full model.

Not yet implemented (later phases — see `docs/CLAUDE_CODE_PLAN.md`):
real Gemini Live transport, signed voice-gateway tokens, Stripe
checkout/webhooks, the full coaching evaluator, production deployment.

## Architecture
- `apps/web`: Next.js + TypeScript
- `services/voice-gateway`: Fastify + WebSocket voice relay
- `packages/shared`: shared types
- `supabase`: migrations and seed data
- `docs`: product and engineering docs

Recommended deployment:
- Web: Vercel
- Voice gateway: Render or Cloud Run
- Auth/DB: Supabase
- Payments: Stripe

## Important
The starter uses a mock voice provider by default. The Gemini Live provider is deliberately isolated behind an interface and should be implemented against the current official Gemini Live API in Phase 4.

Suggested env-configurable model:
`GEMINI_LIVE_MODEL=gemini-3.8-live`

## Start
```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local
cp services/voice-gateway/.env.example services/voice-gateway/.env
```

Fill in `apps/web/.env.local` with your Supabase project's URL, anon key,
and **service-role key** (`NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` — the last one
is required for the entitlement API routes, never exposed to the browser).
Apply the migrations and seed in `supabase/` to that project. Without these
set, the app still starts and renders (scenario pages fall back to static
sample data), but auth-gated pages show a "connect Supabase" notice instead
of live data.

To exercise the Phase 2 entitlement/ledger logic against a real Postgres
server (no Supabase project needed), see
`supabase/tests/phase2_entitlement.sql`.

```bash
pnpm dev:web
pnpm dev:gateway
```

- Web: http://localhost:3000 (health check at `/api/health`)
- Voice gateway: http://localhost:8787 (health check at `/health`, WebSocket at `/ws`)

## Validate
```bash
pnpm typecheck
pnpm test
pnpm build
```

Read `CLAUDE.md` and `docs/CLAUDE_CODE_PLAN.md` before building with Claude Code.
