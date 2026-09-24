# Cold Call Gym

Voice-first AI sales practice — no account required.

## Core loop
Start Practicing Free (name + email + phone) → choose scenario → call AI prospect → handle
objections → end call → receive coaching → practice again tomorrow.

## Business model

Cold Call Gym is **free, with no accounts and no self-service payment flow of any kind**:

- **Free access, no account**: submit name, email, and phone at `/start` and get instant access
  — no password, no email verification, no signup flow. AI voice practice is free and unlimited
  — no daily allowance, no per-call ceiling.
- **Expanded / team access**: anyone wanting more than self-service (dedicated support, custom
  scenarios, seats/reporting for a team) uses the **Contact Sales** form (`/contact-sales`) —
  there is no checkout, no purchased credits, no subscription plan, and no Stripe integration
  anywhere in this codebase.

See `docs/MONETIZATION.md` for the full allowance/reset mechanics and `docs/SECURITY.md` for what
the access session does and does not prove.

## Status: no-account, lead-gated MVP

- **No accounts, no Supabase.** Cold Call Gym previously used Supabase for auth and Postgres
  storage; both have been removed from the active architecture (see
  `legacy/supabase/README.md` for the archived history). Leads/call-session records now live in a
  pluggable storage abstraction (`apps/web/src/lib/server/store/`) — Redis-backed (Upstash) in
  production when `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` are set, falling back to a
  non-durable in-memory store when they aren't (local dev, zero setup). `GET /api/health` reports
  which is active.
- **Access, not authentication.** `/start` collects name + email + phone, creates a lead record,
  and sets an opaque server-generated access-session cookie. That cookie unlocks `/dashboard`,
  `/scenarios`, and `/call` and is the key the daily free-usage allowance is tracked against — it
  does not verify identity. See `docs/SECURITY.md` for exactly what this does and doesn't
  guarantee.
- **The voice gateway is still the real, authoritative call pipeline** (this part is unchanged
  in spirit from the earlier architecture): `POST /api/voice/session` signs a short-lived
  JWT (`VOICE_GATEWAY_SIGNING_SECRET`) the browser presents to open a WebSocket at
  `services/voice-gateway`; the gateway verifies the token, re-validates the session's live state
  (via the web app's internal session API — see `docs/ARCHITECTURE.md`), meters active call time
  with its own monotonic clock (there is no cutoff — calls run until the caller ends them), and
  finalizes usage itself — the browser can never submit a duration for billing anywhere.
- **Real Gemini Live voice (Phase 4).** Browser microphone → Voice Gateway → Gemini Live → native
  audio response → Voice Gateway → browser speaker. The browser never talks to Gemini directly,
  and `GEMINI_API_KEY` lives only on the gateway process. `VOICE_PROVIDER=mock` (default) keeps
  the deterministic mock provider for local dev/CI without any Gemini credential;
  `VOICE_PROVIDER=gemini` switches to real audio. See `docs/ARCHITECTURE.md`'s "Voice provider"
  section for the full pipeline, formats, and barge-in/turn-detection behavior.
- **No payments.** Every access identity gets a single free 600-second/UTC-day allowance;
  expanded access goes through Contact Sales (`POST /api/contact-sales`). See
  `docs/MONETIZATION.md`.

Not yet implemented: the full coaching evaluator. There is no payments phase.

## Architecture
- `apps/web`: Next.js + TypeScript — owns the lead/call-session storage abstraction
- `services/voice-gateway`: Fastify + WebSocket voice relay — calls back into the web app's
  internal session API instead of a shared database
- `packages/shared`: shared types
- `legacy/supabase`: archived, no longer used by the running application
- `docs`: product and engineering docs

Recommended deployment:
- Web: Vercel
- Storage: Upstash Redis (add from Vercel's Storage tab)
- Voice gateway: Render or Cloud Run

There is no payments provider to deploy, and no relational database/migrations to manage. Read
`docs/DEPLOYMENT.md`'s "Production persistence" section before launching — without
`UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` set, the app falls back to a non-durable
in-memory store that will not work correctly across Vercel's serverless instances.

## Important
`VOICE_PROVIDER=mock` (default) keeps the deterministic mock provider for local dev/CI — no
Gemini credential needed. `VOICE_PROVIDER=gemini` uses the real `@google/genai` Live API
implementation (`services/voice-gateway/src/providers/gemini-live-provider.ts`); the gateway
refuses to start with `VOICE_PROVIDER=gemini` and no `GEMINI_API_KEY` configured, rather than
failing silently on the first call.

Model is configurable via `GEMINI_MODEL` (default `gemini-3.8-live`) — never hardcoded elsewhere.

## Start
```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local
cp services/voice-gateway/.env.example services/voice-gateway/.env
```

Fill in `apps/web/.env.local`: `VOICE_GATEWAY_URL`, `VOICE_GATEWAY_SIGNING_SECRET`, and
`INTERNAL_API_KEY` (a shared secret the voice gateway uses to call this app's internal
call-session API — see `docs/ARCHITECTURE.md`). `UPSTASH_REDIS_REST_URL`/
`UPSTASH_REDIS_REST_TOKEN` are optional locally (the app falls back to an in-memory store with
zero external setup) but **required for a real deployment** — see `docs/DEPLOYMENT.md`.

Fill in `services/voice-gateway/.env` too (copied from `.env.example`): `WEB_APP_URL` (the web
app's base URL, e.g. `http://localhost:3000` locally) and `INTERNAL_API_KEY` (must match the web
app's value exactly), plus `VOICE_GATEWAY_SIGNING_SECRET` (must also match the web app's value —
it's how the gateway verifies a call-session token actually came from your web server). Leave
`VOICE_PROVIDER=mock` for local dev without a Gemini key; set `VOICE_PROVIDER=gemini` and
`GEMINI_API_KEY` to use real voice.

```bash
pnpm dev:web
pnpm dev:gateway
```

- Web: http://localhost:3000 (health check at `/api/health`)
- Voice gateway: http://localhost:8787 (health check at `/health`, WebSocket at `/ws`)

Visit `/start`, submit name/email/phone, and you're immediately at `/dashboard` — no signup, no
login.

Note (in-memory store / local dev only): right after starting `pnpm dev:web` for the first time,
the very first requests to different routes can transiently miss each other's in-memory state
while Next.js compiles each route on demand — see the doc comment on
`apps/web/src/lib/server/store/memory-store.ts` for why, and why this doesn't happen in a
production build (`pnpm build && pnpm --filter web start`). If `/start` seems not to have "taken"
on your very first try in dev mode, submit it again. This doesn't apply once Redis is configured.

## Validate
```bash
pnpm typecheck
pnpm test
pnpm build
```

Read `CLAUDE.md` and `docs/CLAUDE_CODE_PLAN.md` before building with Claude Code.
