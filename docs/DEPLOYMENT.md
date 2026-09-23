# Deployment

## Database — Supabase (migrations & seed)

Migrations and seed data deploy via two manually-triggered GitHub Actions
workflows (`workflow_dispatch` only — neither runs on push):

- `.github/workflows/supabase-deploy.yml` — `supabase link` then
  `supabase db push` (applies `supabase/migrations/*.sql`), then verifies
  the remote migration history matches the repo via `supabase migration
  list` and fails the workflow on any mismatch. Never resets the database.
- `.github/workflows/supabase-seed.yml` — runs only
  `supabase/seed.sql` (an idempotent upsert of scenario rows, keyed by
  unique `slug`) via `supabase db query --file`. Safe to re-run; never
  touches `call_sessions`, `profiles`, `auth.users`, or `sales_inquiries`.

Required repository secrets: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_ID`,
`SUPABASE_DB_PASSWORD`. Trigger deploy first, then seed, from the Actions
tab; review the "Deploy migrations" step's output before re-running.

## Web — Vercel
Set:
- NEXT_PUBLIC_SUPABASE_URL
- NEXT_PUBLIC_SUPABASE_ANON_KEY
- SUPABASE_SERVICE_ROLE_KEY
- VOICE_GATEWAY_URL
- VOICE_GATEWAY_SIGNING_SECRET

Cold Call Gym has no self-service payment flow, so there are no Stripe
environment variables to set (see `docs/MONETIZATION.md`).

## Voice Gateway — Render / Cloud Run
Set:
- PORT
- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY
- VOICE_GATEWAY_SIGNING_SECRET
- VOICE_PROVIDER
- GEMINI_API_KEY
- GEMINI_LIVE_MODEL

Health endpoint: `/health`
WebSocket endpoint: `/ws?token=<signed voice-session token>`

`VOICE_GATEWAY_SIGNING_SECRET` must be the exact same value on both the web
app and the voice gateway — it's how the gateway verifies a token was
actually issued by the web app's `POST /api/voice/session`. `SUPABASE_URL`
on the gateway should point at the same Supabase project as
`NEXT_PUBLIC_SUPABASE_URL` on the web app (the gateway just doesn't need the
`NEXT_PUBLIC_` prefix, since it's never bundled into a browser).

`GET /health` reports `tokenVerification` and `database` as
`"configured"`/`"not_configured"` based on whether those env vars are
present — useful for a load-balancer health check to distinguish "process
is up" from "process is actually able to do its job."

## Production checklist
- verify daily usage never goes negative and never exceeds the 600-second
  allowance, including under concurrent calls
- verify call stops at quota limit (see docs/ARCHITECTURE.md's voice
  session lifecycle section for how `maxAllowedSeconds` / `MAX_CALL_SECONDS`
  interact)
- verify disconnect recovery
- verify no secrets in browser
- document Gemini quota/rate limits
- if running more than one voice-gateway instance, replace the in-memory
  `activeSessionIds` duplicate-connection guard
  (`services/voice-gateway/src/app.ts`) with a shared store (e.g. Redis) —
  documented as a known Phase 3 limitation, not yet solved
