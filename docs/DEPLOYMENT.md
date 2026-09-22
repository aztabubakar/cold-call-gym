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
WebSocket endpoint: `/ws`

## Production checklist
- test Stripe webhook
- verify no negative credits
- verify call stops at quota limit
- verify disconnect recovery
- verify no secrets in browser
- document Gemini quota/rate limits
