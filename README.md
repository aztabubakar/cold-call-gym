# Cold Call Gym

Voice-first AI sales practice SaaS.

## Core loop
Choose scenario → call AI prospect → handle objections → end call → receive coaching → practice again.

## Status: Phase 1 complete (foundation)
- Auth shell (sign up / sign in / sign out) via Supabase
- Dashboard (free minutes, paid credits, calls this week, recent sessions, recommended drills)
- Scenario browsing + detail (pre-call) pages, backed by Supabase with a static fallback
- Call page in mock voice mode (client-side simulated call: timer, mute, end call)
- Voice gateway running in mock mode with a working WebSocket lifecycle
- Supabase migrations + seed (6 starter scenarios) and a profile-on-signup trigger
- Entitlement utilities (free/paid allocation math) preserved and covered by tests

Not yet implemented (later phases — see `docs/CLAUDE_CODE_PLAN.md`):
real Gemini Live transport, Stripe checkout/webhooks, production credit charging,
the full coaching evaluator, production deployment.

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

Fill in `apps/web/.env.local` with your Supabase project's URL and anon key
(`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`). Apply the
migrations and seed in `supabase/` to that project. Without these set, the
app still starts and renders (scenario pages fall back to static sample
data), but auth-gated pages show a "connect Supabase" notice instead of
live data.

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
