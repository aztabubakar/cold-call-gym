# Deployment

Cold Call Gym has no accounts. There is nothing to migrate or seed for the old Supabase schema,
and no `SUPABASE_*` secrets to configure — the old `supabase-deploy.yml`/`supabase-seed.yml`
GitHub Actions workflows have been removed (see `legacy/supabase/README.md`).

## Production persistence

`apps/web/src/lib/server/store/index.ts` picks its backing implementation automatically:

- **`UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` set** → the durable, multi-instance-safe
  Redis-backed store (`redis-store.ts`). **This is required for a real deployment on Vercel** —
  Vercel serverless functions are not guaranteed to be the same process between requests, so the
  in-memory fallback below silently loses state (a lead created by `/start` can be invisible on
  the very next request, daily-allowance tracking can reset unexpectedly, etc.). Add the Upstash
  integration from Vercel's Storage tab (or create a database directly at upstash.com) and both
  env vars are set for you automatically; add them to the voice gateway's environment too only if
  you want it to read the same store directly (it doesn't — it goes through the internal session
  API instead, see `docs/ARCHITECTURE.md`).
- **Neither set** → the in-memory fallback (`memory-store.ts`) — a plain in-process `Map`. Fine
  for local development (zero external setup) and for demos on a single long-lived process, but
  **not durable and not multi-instance-safe**: it does not survive a restart/redeploy/cold-start,
  and different serverless invocations each get their own independent copy.

**`GET /api/health` on the web app reports which backend is active** (`"store":"redis"` or
`"store":"memory"`) — the fastest way to confirm the fix actually took effect after setting the
env vars on Vercel: `curl https://<your-app>.vercel.app/api/health`.

Swapping to a different datastore later still means writing one new module against the
interfaces in `apps/web/src/lib/server/store/types.ts` and changing what `index.ts` exports — no
other file in the app needs to change. The entitlement math itself (`usage-math.ts`) is pure and
storage-agnostic and is reused as-is by both implementations.

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
- `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` — **required for a real deployment**, see
  "Production persistence" above. Without these, the app still builds and runs, but falls back to
  the non-durable in-memory store.

Cold Call Gym has no self-service payment flow, so there are no Stripe or
`SUPABASE_*` environment variables to set (see `docs/MONETIZATION.md`).

**Important**: without `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` set, the storage layer
is in-memory and not durable (see "Production persistence" above) — a Vercel deployment in that
state is suitable for demos and review only, not for real users depending on their daily
allowance or Contact Sales submission being reliably recorded. Check `GET /api/health` after
deploying to confirm `"store":"redis"`.

## Voice Gateway — Render / Cloud Run
Set:
- `PORT`
- `WEB_APP_URL` — the deployed web app's base URL; the gateway calls
  `${WEB_APP_URL}/api/internal/sessions/...` for every session-state read/write (see
  `docs/ARCHITECTURE.md`)
- `INTERNAL_API_KEY` — must match the web app's value exactly
- `VOICE_GATEWAY_SIGNING_SECRET`
- `VOICE_PROVIDER` — `gemini` for real voice, `mock` to run without a Gemini credential
- `GEMINI_API_KEY` — **required when `VOICE_PROVIDER=gemini`**; the gateway refuses to start
  without it in that case (`services/voice-gateway/src/lib/config.ts`). Read only by this
  process — never put this in Vercel/the web app's environment (see below).
- `GEMINI_MODEL` — default `gemini-3.8-live` if unset
- `MAX_CALL_SECONDS` — default 1800 if unset; the gateway's own absolute safety ceiling,
  independent of a user's remaining daily allowance (see `docs/MONETIZATION.md`)

**`GEMINI_API_KEY` belongs only on whatever process actually runs the voice gateway.** Do not add
it to the Vercel project's environment variables unless the voice gateway is itself deployed as a
Vercel function (it isn't, in the deployment shape documented here — the gateway is a
long-running WebSocket process, which Vercel's serverless functions don't support well; use
Render/Cloud Run/Fly/etc. as above).

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
- set `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` on the web app and confirm
  `GET /api/health` reports `"store":"redis"` before depending on correct entitlement/lead-capture
  behavior in production (see "Production persistence" above) — this is the single most important
  item on this list for a Vercel deployment
- verify daily usage never goes negative and never exceeds the 600-second allowance, including
  under concurrent calls — covered by `apps/web/src/lib/server/store/usage-math.test.ts` (the pure
  math) and `redis-store.test.ts` (the distributed-lock-backed concurrency guarantee); the
  in-memory fallback's concurrency guarantee only holds within a single process, so this matters
  more once you're actually depending on Redis
- verify call stops at quota limit (see docs/ARCHITECTURE.md's voice
  session lifecycle section for how `maxAllowedSeconds` / `MAX_CALL_SECONDS`
  interact)
- verify disconnect recovery
- verify no secrets in browser (`INTERNAL_API_KEY`, `VOICE_GATEWAY_SIGNING_SECRET`,
  `GEMINI_API_KEY`, `UPSTASH_REDIS_REST_TOKEN` — none should ever appear in a `NEXT_PUBLIC_`
  variable or a browser-visible response)
- document Gemini quota/rate limits
- the web app must be served over HTTPS in production — `getUserMedia` (microphone access) is
  only available in a secure context (HTTPS or `localhost`); Vercel serves HTTPS by default, so
  this is only a concern for a custom deployment
- if running more than one voice-gateway instance, replace the in-memory
  `activeSessionIds` duplicate-connection guard
  (`services/voice-gateway/src/app.ts`) with a shared store (e.g. the same Redis instance) —
  a known limitation, not yet solved
