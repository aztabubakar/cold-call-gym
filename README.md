# Cold Call Gym

Voice-first AI sales practice SaaS.

## Core loop
Choose scenario → call AI prospect → handle objections → end call → receive coaching → practice again.

## Status: Phase 3 complete (voice gateway session lifecycle)
- Phase 1: auth shell, dashboard, scenario browsing/detail, mock call UI,
  Supabase foundation — see git history for details.
- Phase 2: server-authoritative entitlement (10 free min/day, UTC boundary,
  no reset job), immutable credit ledger, atomic + idempotent usage
  finalization (`finalize_call_usage` Postgres RPC with per-user advisory
  locking), one-time welcome credits, `GET /api/entitlement`,
  `POST /api/voice/session` (call authorization).
- Phase 3: the voice gateway is now the real, authoritative call pipeline.
  `POST /api/voice/session` signs a short-lived JWT
  (`VOICE_GATEWAY_SIGNING_SECRET`) the browser presents to open a
  WebSocket at `services/voice-gateway`; the gateway verifies the token,
  re-validates the session against the live database, meters active call
  time with its own monotonic clock, enforces `maxAllowedSeconds`
  (capped by the gateway's own `MAX_CALL_SECONDS`), and finalizes usage
  itself via the same Phase 2 RPC — the browser can no longer submit a
  duration for billing anywhere (the Phase 2 finalize endpoint was
  removed). See `docs/ARCHITECTURE.md` for the full lifecycle diagram and
  `docs/SECURITY.md` for the trust-boundary details.

Not yet implemented (later phases — see `docs/CLAUDE_CODE_PLAN.md`):
real Gemini Live transport, Stripe checkout/webhooks, the full coaching
evaluator, production deployment.

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

Fill in `services/voice-gateway/.env` too (copied from `.env.example`):
`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` (same project as above, no
`NEXT_PUBLIC_` prefix needed since the gateway is a trusted server) and
`VOICE_GATEWAY_SIGNING_SECRET` (must match the web app's value exactly —
it's how the gateway verifies a call session token actually came from your
web server).

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

## Deploying to the hosted Supabase project

Two manually-triggered GitHub Actions workflows (Actions tab → select
workflow → "Run workflow" — neither runs automatically on push):

- **`.github/workflows/supabase-deploy.yml`** — links to the hosted
  project and runs `supabase db push` to apply any migrations in
  `supabase/migrations/` not yet recorded remotely, then verifies the
  remote migration history matches the repository (fails the workflow if
  not). Never runs `supabase db reset` and never touches seed data.
- **`.github/workflows/supabase-seed.yml`** — upserts
  `supabase/seed.sql` (scenario rows only, keyed by unique `slug`) against
  the hosted project. Safe to run repeatedly; never resets the database or
  touches user/session/credit data.

Both require these repository secrets (Settings → Secrets and variables →
Actions): `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_ID`,
`SUPABASE_DB_PASSWORD`.

Read `CLAUDE.md` and `docs/CLAUDE_CODE_PLAN.md` before building with Claude Code.
