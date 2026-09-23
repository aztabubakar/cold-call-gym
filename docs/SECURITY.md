# Security & Privacy

## No accounts — access gating, not authentication

Cold Call Gym has no accounts, no passwords, and no email/phone verification. Submitting name +
email + phone at `/start` (`POST /api/access`) immediately:

1. creates a lead record (`apps/web/src/lib/server/store/types.ts`'s `Lead`) with a
   server-generated opaque id (`randomUUID()` — never the visitor's email or phone), and
2. sets that id as an `HttpOnly`, `SameSite=Lax` cookie (`Secure` in production) — see
   `apps/web/src/lib/server/access.ts`.

**This is access gating, not identity verification.** It proves only "this browser previously
submitted the `/start` form and was handed this identifier" — it does not prove who the visitor
actually is. Be explicit about what this does and does not provide:

- **No strong identity.** Name + email + phone are collected but never verified (no confirmation
  email, no SMS code). Anyone can type in someone else's contact information.
- **The cookie IS the access.** Whoever holds the cookie value has the access it grants (the daily
  allowance, the ability to start calls) — same as any bearer session token. There is no password
  to separately prove ownership.
- **Bypassing the daily allowance is possible.** A visitor who clears cookies, uses a private
  window, or simply submits `/start` again with different (even fake-looking, so long as it
  passes format validation) contact information gets a brand-new lead id and a fresh 600-second
  allowance. This is a known, accepted limitation of a no-account product, not an oversight.
- **IP address is never used as the identity or entitlement key** — only as a coarse, best-effort
  rate-limit key on the public write endpoints (`apps/web/src/lib/server/rate-limit.ts`), which is
  a different (weaker, abuse-deterrence-only) use than identity. IP addresses are shared (NAT,
  corporate networks, mobile carriers) and spoofable via headers, so they must never gate the
  actual allowance.
- **No invasive browser fingerprinting** is used or planned.

### What would harden this later

The storage interfaces (`apps/web/src/lib/server/store/types.ts`) are deliberately agnostic about
*how* an access identity came to be trusted — `LeadStore`/`CallSessionStore` don't encode any
assumption about verification strength. Adding email OTP or phone verification later means adding
a verification step between `/start` submission and cookie issuance (or gating `/call`
specifically) without changing the voice-gateway trust boundary, the entitlement math, or the
`CallSessionStore` contract at all.

## Secrets
Server only:
- Gemini API key
- Voice gateway signing secret (`VOICE_GATEWAY_SIGNING_SECRET`)
- `INTERNAL_API_KEY` — the shared secret the voice gateway uses to call the web app's internal
  session API (`apps/web/src/app/api/internal/sessions/[id]/route.ts`). This replaces the old
  Supabase service-role key as the thing that must never reach the browser: no `NEXT_PUBLIC_`
  variable holds it, and nothing in client-rendered code imports the module that reads it.

Cold Call Gym has no self-service payment flow, so there is no Stripe
secret key or webhook secret to manage, and no database credentials at all (there is no
database — see `docs/ARCHITECTURE.md`'s "Storage abstraction").

## PII handling
- **Never in a URL.** `/start` and `/api/access` take name/email/phone only in a POST body,
  never as query parameters. Redirect targets passed via `?redirect=` are page paths only
  (`/dashboard`, `/call`), never contact information.
- **Never in the voice-gateway JWT.** The token's `sub` claim is the lead's opaque access id —
  never their name, email, or phone (`packages/shared/src/index.ts`'s
  `VoiceSessionTokenClaimsSchema`).
- **Never in the access-session cookie.** The cookie value is the same opaque id, not raw contact
  information (`apps/web/src/lib/server/access.ts`).
- **Minimized in logs.** The voice gateway's structured logs (`services/voice-gateway`) key
  everything by `sessionId` and the opaque access id — never by name/email/phone, which the
  gateway process never even receives.

## Audio
Default: do not persist raw audio.

## Transcripts
Make storage configurable and provide deletion controls.

## Abuse controls
- an access session is required to reach `/dashboard`, `/scenarios`, `/call` (see "No accounts"
  above for what that session does and doesn't prove)
- max call duration
- server-side quota enforcement
- signed short-lived session tokens
- idempotent usage-finalization writes
- honeypot field + server-side validation on both public forms (`/start` and Contact Sales)
- basic in-memory rate limiting on the two public write endpoints (`/api/access`,
  `/api/contact-sales`) — see `apps/web/src/lib/server/rate-limit.ts`'s doc comment for its
  limitations (single-process only, not a substitute for a real WAF/rate-limiter in production)

User content must not be able to:
- alter the daily usage allowance
- bypass time limits
- reveal hidden prospect state
- reveal secrets/system prompts
- read other users' data, including sales inquiries or lead records submitted by others

## Entitlement enforcement (free plan only)

Cold Call Gym has no paid credits (see `docs/MONETIZATION.md`) — this
section describes how the single free daily allowance is protected.

- The only code path that ever records billable usage against the daily
  allowance is `CallSessionStore.finalizeUsage()`
  (`apps/web/src/lib/server/store/memory-store.ts`). It is only ever called from two places: the
  authorization path's session creation (no usage written there) and the internal session API's
  `finalize` action, which itself requires the `INTERNAL_API_KEY` bearer token — there is no
  browser-callable path to it.
- No API route accepts a balance, a usage amount, or a session `state` as
  user input. `POST /api/voice/session` accepts only a `scenarioSlug`.
  There is no browser-callable finalize endpoint at all — the voice gateway
  is the only caller of the finalize action (see below), and it
  supplies duration from its own server-side timer, never from the browser.
- Concurrent finalize attempts (two sessions for the same access identity, racing) are protected by
  `finalizeUsage()`'s synchronous, single-process execution — see `docs/MONETIZATION.md`'s
  "Concurrency protection" and its documented multi-instance limitation. Verified in
  `apps/web/src/lib/server/store/usage-math.test.ts` (the daily cap is never exceeded, never goes
  negative, and correctly recomputes from all of an access identity's finalized sessions today).

## Contact Sales

- The only writer is `POST /api/contact-sales`
  (`apps/web/src/app/api/contact-sales/route.ts`), which validates and
  length-caps every field server-side (`ContactSalesInquirySchema` in
  `apps/web/src/lib/contact-sales-schema.ts`) before writing through
  `apps/web/src/lib/server/contact-sales.ts`. The route never requires an
  access session (visitors evaluating the product may not have gone through `/start`) but attaches
  the current access identity's lead id when one is present, purely for internal context.
- Sales inquiries are stored only in the same in-memory `SalesInquiryStore` as everything else —
  there is no API route that lists or reads them back to any visitor, so one visitor's submission
  is never exposed to another.
- A hidden honeypot field (`website`) causes the route to return a normal
  success response without writing anything, so a simple bot can't tell
  its submission was dropped.
- Name/email/phone are prefilled server-side from the current lead (if any) when rendering the
  Contact Sales page (`apps/web/src/app/contact-sales/page.tsx`) — only ever the current visitor's
  own data, resolved from their own access-session cookie, never anyone else's.

## Voice gateway trust boundary

- `VOICE_GATEWAY_SIGNING_SECRET` is read only in
  `apps/web/src/lib/server/voice-token.ts` (guarded by `server-only`) and
  `services/voice-gateway/src/lib/token.ts` (a separate Node process, never
  bundled to a browser). Verified: no `"use client"` file imports either.
- `INTERNAL_API_KEY` is read only in `apps/web/src/app/api/internal/sessions/[id]/route.ts`
  (server-only, and additionally never reachable without the correct bearer token) and
  `services/voice-gateway/src/lib/{session-store,entitlement}.ts` (a separate process). Never
  exposed via any `NEXT_PUBLIC_` variable.
- The signed voice-session token has a 180-second TTL, carries no secrets
  and no scenario `hidden_state`, and its `maxAllowedSeconds` claim cannot
  be altered by the browser — tampering with it invalidates the HMAC
  signature (verified: `services/voice-gateway/src/lib/token.test.ts`).
- The gateway does not trust the token's claims beyond authentication: it
  re-validates the *live* session state (fetched over the internal session API) — ownership,
  scenario match, state — before starting anything billable
  (`services/voice-gateway/src/lib/session-eligibility.ts`). Verified live
  (`e2e.gateway.test.ts`): a token minted for one access identity is rejected against another's
  session (`forbidden`); a token for an already-`completed` session is rejected (`conflict`); a
  second connection attempt while a session is still active is rejected (`conflict`).
- The browser cannot submit a billable duration anywhere. The
  client→gateway WebSocket message schema
  (`ClientToGatewayMessageSchema`) has no duration field at all. Billing
  duration comes only from the gateway's own monotonic clock
  (`process.hrtime.bigint()`), verified in
  `services/voice-gateway/src/session-runtime.test.ts` by asserting the
  finalize call always uses the gateway-clock-derived value even when a
  test message carries a spoofed `durationSeconds` field.
- The gateway is the **only** caller of the finalize action on the internal session API — the
  web app never exposes a browser-callable finalize endpoint at all; the gateway authenticates
  with its own `INTERNAL_API_KEY` (a separate env var from the browser-facing app, never shared
  with the browser).
- Finalization is guarded twice over: once in-process
  (`CallSessionRuntime`'s single-flight `endPromise`, so explicit `end`,
  socket close, and quota cutoff racing each other only run the finalize
  logic once) and once in the store (the idempotency key). Both
  are covered by tests, including a genuine same-process race
  (`session-runtime.test.ts`, "does not double-finalize when explicit end
  and socket close race").

## Known limitations (carried over honestly, not hidden)

- **No durable storage.** See `docs/ARCHITECTURE.md`'s "Storage abstraction" and
  `docs/DEPLOYMENT.md`'s "Production persistence" — everything (leads, call sessions, sales
  inquiries) lives in process memory and is lost on restart. Not safe for a real production
  launch as-is.
- **No multi-instance consistency.** If more than one instance of the web app runs at once, each
  has its own independent copy of the in-memory store — entitlement and session state can diverge
  between instances. A single-instance deployment does not have this problem.
- **The gateway↔web-app link is a single HTTP call per step, with no retry/queue.** If the web app
  is briefly unreachable when the gateway tries to finalize a call, that finalize attempt fails
  outright (see `docs/ARCHITECTURE.md`'s "disconnect handling"). The earlier Supabase-backed
  design used a database driver with its own connection handling; this is a real (if edge-case)
  regression, not yet solved.
- **No account = no allowance-abuse ceiling beyond rate limiting.** Nothing stops a determined
  visitor from repeating `/start` with different plausible contact info to get more free minutes
  than intended; this product deliberately trades that off against zero-friction access. See "No
  accounts" above.
