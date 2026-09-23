# Cold Call Gym

Voice-first AI sales practice — no account required.

## Core loop
Start Practicing Free (name + email + phone) → choose scenario → call AI prospect → handle
objections → end call → receive coaching → practice again tomorrow.

## Business model

Cold Call Gym is **free, with no accounts and no self-service payment flow of any kind**:

- **Free access, no account**: submit name, email, and phone at `/start` and get instant access
  — no password, no email verification, no signup flow. Every access identity gets 10 minutes
  (600 seconds) of AI voice practice per UTC calendar day, measured authoritatively by the voice
  gateway.
- **Expanded / team access**: anyone who needs more than the free daily allowance uses the
  **Contact Sales** form (`/contact-sales`) — there is no checkout, no purchased credits, no
  subscription plan, and no Stripe integration anywhere in this codebase.

See `docs/MONETIZATION.md` for the full allowance/reset mechanics and `docs/SECURITY.md` for what
the access session does and does not prove.

## Status: no-account, lead-gated MVP

- **No accounts, no Supabase.** Cold Call Gym previously used Supabase for auth and Postgres
  storage; both have been removed from the active architecture (see
  `legacy/supabase/README.md` for the archived history). The app now has no database — a
  pluggable, documented-as-non-durable in-memory storage abstraction stands in for one (see
  `apps/web/src/lib/server/store/`).
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
  with its own monotonic clock, enforces `maxAllowedSeconds` (capped by the gateway's own
  `MAX_CALL_SECONDS`), and finalizes usage itself — the browser can never submit a duration for
  billing anywhere.
- **Real Gemini Live voice (Phase 4).** Browser microphone → Voice Gateway → Gemini Live → native
  audio response → Voice Gateway → browser speaker. The browser never talks to Gemini directly,
  and `GEMINI_API_KEY` lives only on the gateway process. `VOICE_PROVIDER=mock` (default) keeps
  the deterministic mock provider for local dev/CI without any Gemini credential;
  `VOICE_PROVIDER=gemini` switches to real audio. See `docs/ARCHITECTURE.md`'s "Voice provider"
  section for the full pipeline, formats, and barge-in/turn-detection behavior.
- **No payments.** Every access identity gets a single free 600-second/UTC-day allowance;
  expanded access goes through Contact Sales (`POST /api/contact-sales`). See
  `docs/MONETIZATION.md`.

Not yet implemented: the full coaching evaluator, a durable production datastore.
There is no payments phase.

## Architecture
- `apps/web`: Next.js + TypeScript — owns the lead/call-session storage abstraction
- `services/voice-gateway`: Fastify + WebSocket voice relay — calls back into the web app's
  internal session API instead of a shared database
- `packages/shared`: shared types
- `legacy/supabase`: archived, no longer used by the running application
- `docs`: product and engineering docs

Recommended deployment:
- Web: Vercel
- Voice gateway: Render or Cloud Run

There is no database and no payments provider to deploy. Read
`docs/DEPLOYMENT.md`'s "Production persistence" section before launching — the in-memory store is
not durable and must be replaced before real usage depends on it.

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
call-session API — see `docs/ARCHITECTURE.md`). No database credentials are needed; the app has
no external dependencies to configure to run locally.

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

Note: right after starting `pnpm dev:web` for the first time, the very first requests to
different routes can transiently miss each other's in-memory state while Next.js compiles each
route on demand — see the doc comment on `apps/web/src/lib/server/store/memory-store.ts` for why,
and why this doesn't happen in a production build (`pnpm build && pnpm --filter web start`). If
`/start` seems not to have "taken" on your very first try in dev mode, submit it again.

## Validate
```bash
pnpm typecheck
pnpm test
pnpm build
```

Read `CLAUDE.md` and `docs/CLAUDE_CODE_PLAN.md` before building with Claude Code.
