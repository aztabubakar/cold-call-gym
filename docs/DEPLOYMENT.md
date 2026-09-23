# Deployment

Cold Call Gym has no database and no accounts. There is nothing to migrate or seed, and no
`SUPABASE_*` secrets to configure — the old `supabase-deploy.yml`/`supabase-seed.yml` GitHub
Actions workflows have been removed (see `legacy/supabase/README.md`).

## Production persistence — read this before a real launch

`apps/web/src/lib/server/store/memory-store.ts` — the current backing implementation of
`LeadStore`/`CallSessionStore`/`SalesInquiryStore` — is a **plain in-process JavaScript `Map`**.
It is not durable and not shared across instances:

- **It does not survive a restart.** Every deploy, and every serverless cold start, wipes it.
- **It does not survive horizontal scaling.** Vercel serverless functions are not guaranteed to
  be the same process between requests, or even between two requests a few seconds apart — running
  the web app on Vercel as-is means leads and call-session/entitlement state can silently vanish
  or become inconsistent between requests. A visitor could see their daily allowance reset
  mid-session, or a call session created by one invocation could be invisible to another.
- **This is documented, not hidden.** Do not deploy this to real users relying on daily-allowance
  enforcement or lead capture working correctly without first replacing this store.

**What's needed before launch:** implement `LeadStore`/`CallSessionStore`/`SalesInquiryStore`
(`apps/web/src/lib/server/store/types.ts`) against a real shared datastore (Postgres, a managed
key-value store, etc. — deliberately not chosen or added in this refactor per the instruction not
to silently introduce a new third-party database) and point `apps/web/src/lib/server/store/index.ts`
at it. No other file needs to change — every call site depends only on the interfaces in
`types.ts`. The entitlement math itself (`usage-math.ts`) is pure and storage-agnostic and can be
reused as-is by a real implementation.

## Web — Vercel

**Root Directory**: `apps/web`
**Install command**: `pnpm install` (run from the monorepo root so the `workspace:*` dependency on
`@cold-call-gym/shared` resolves — Vercel's monorepo support handles this automatically when Root
Directory is set to `apps/web` with the default pnpm workspace detection)
**Build command**: `pnpm build` (or `next build`, run from `apps/web`)
**Output**: standard Next.js App Router output; no special configuration

Set these environment variables:
- `VOICE_GATEWAY_URL` — the deployed voice gateway's base URL
- `VOICE_GATEWAY_SIGNING_SECRET`
- `INTERNAL_API_KEY` — must match the voice gateway's value exactly
- `NEXT_PUBLIC_APP_URL`

Cold Call Gym has no self-service payment flow and no database, so there are no Stripe or
`SUPABASE_*` environment variables to set (see `docs/MONETIZATION.md`, and "Production
persistence" above for what storage config a real launch will eventually need).

**Important**: because the storage layer is in-memory and not durable (see above), a Vercel
deployment of this app as-is is suitable for demos and review, not for real users depending on
their daily allowance or Contact Sales submission being reliably recorded.

## Voice Gateway — Render / Cloud Run
Set:
- `PORT`
- `WEB_APP_URL` — the deployed web app's base URL; the gateway calls
  `${WEB_APP_URL}/api/internal/sessions/...` for every session-state read/write (see
  `docs/ARCHITECTURE.md`)
- `INTERNAL_API_KEY` — must match the web app's value exactly
- `VOICE_GATEWAY_SIGNING_SECRET`
- `VOICE_PROVIDER`
- `GEMINI_API_KEY`
- `GEMINI_LIVE_MODEL`

Health endpoint: `/health`
WebSocket endpoint: `/ws?token=<signed voice-session token>`

`VOICE_GATEWAY_SIGNING_SECRET` must be the exact same value on both the web
app and the voice gateway — it's how the gateway verifies a token was
actually issued by the web app's `POST /api/voice/session`. `INTERNAL_API_KEY` must likewise match
exactly on both sides — it's how the web app's internal session API authenticates the gateway (see
`docs/ARCHITECTURE.md`, replacing the old shared Postgres service-role credential).

`GET /health` reports `tokenVerification` and `sessionStore` as
`"configured"`/`"not_configured"` based on whether those env vars are
present — useful for a load-balancer health check to distinguish "process
is up" from "process is actually able to do its job." Note that `sessionStore: "configured"` only
means the gateway *has* a `WEB_APP_URL`/`INTERNAL_API_KEY` pair configured — it does not (and
cannot, without a network call) confirm the web app is actually reachable.

## Production checklist
- replace the in-memory storage abstraction with a durable, shared datastore before depending on
  correct entitlement/lead-capture behavior in production (see "Production persistence" above)
- verify daily usage never goes negative and never exceeds the 600-second
  allowance, including under concurrent calls (once a real datastore is in place — the in-memory
  implementation's concurrency guarantee, verified in
  `apps/web/src/lib/server/store/usage-math.test.ts`, only holds within a single process)
- verify call stops at quota limit (see docs/ARCHITECTURE.md's voice
  session lifecycle section for how `maxAllowedSeconds` / `MAX_CALL_SECONDS`
  interact)
- verify disconnect recovery
- verify no secrets in browser (`INTERNAL_API_KEY`, `VOICE_GATEWAY_SIGNING_SECRET`,
  `GEMINI_API_KEY` — none should ever appear in a `NEXT_PUBLIC_` variable or a browser-visible
  response)
- document Gemini quota/rate limits
- if running more than one voice-gateway instance, replace the in-memory
  `activeSessionIds` duplicate-connection guard
  (`services/voice-gateway/src/app.ts`) with a shared store (e.g. Redis) —
  a known limitation, not yet solved
- if running more than one web-app instance (Vercel serverless already does this implicitly),
  the in-memory store limitation above applies immediately — this is the top production blocker
