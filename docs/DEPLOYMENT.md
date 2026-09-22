# Deployment

## Web — Vercel
Set:
- NEXT_PUBLIC_SUPABASE_URL
- NEXT_PUBLIC_SUPABASE_ANON_KEY
- SUPABASE_SERVICE_ROLE_KEY
- STRIPE_SECRET_KEY
- STRIPE_WEBHOOK_SECRET
- VOICE_GATEWAY_URL
- VOICE_GATEWAY_SIGNING_SECRET

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
- test Stripe webhook
- verify no negative credits
- verify call stops at quota limit (see docs/ARCHITECTURE.md's Phase 3
  section for how `maxAllowedSeconds` / `MAX_CALL_SECONDS` interact)
- verify disconnect recovery
- verify no secrets in browser
- document Gemini quota/rate limits
- if running more than one voice-gateway instance, replace the in-memory
  `activeSessionIds` duplicate-connection guard
  (`services/voice-gateway/src/app.ts`) with a shared store (e.g. Redis) —
  documented as a known Phase 3 limitation, not yet solved
