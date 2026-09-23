# Claude Code Instructions

Build Cold Call Gym as a production-quality voice-first SaaS.

## Business model
Free access, no account: submitting name + email + phone at `/start` grants immediate access
(no password, no email verification, no signup flow). Every access identity gets 10 minutes
(600 seconds) of AI voice practice per UTC calendar day, no rollover. There is **no self-service
payment flow** — no purchased credits, no subscriptions, no Stripe integration. Teams or
individuals who need more than the free daily allowance use the Contact Sales form
(`/contact-sales`). See `docs/MONETIZATION.md`.

## Non-negotiables
- No accounts, no passwords, no Supabase. Access is gated by an opaque, server-generated session
  cookie tied to a lead record — this is access gating, not authentication. Never describe it as
  secure identity verification. See `docs/SECURITY.md`.
- Never expose Gemini secrets or the internal-API shared secret (`INTERNAL_API_KEY`) to the
  browser.
- Never put raw name, email, or phone in a cookie, URL, or JWT claim — only opaque, server-issued
  identifiers.
- Server-side usage is the source of truth.
- Do not compute or enforce entitlement in client state.
- The Voice Gateway is authoritative for call duration (its own monotonic clock); the browser's
  countdown is presentation only.
- Do not store raw audio by default.
- Validate API input, including the `/start` access form and the Contact Sales form.
- Add tests for entitlement math, access-session mechanics, session lifecycle, and scoring.
- Keep the mock voice provider working for CI/local development.
- Keep model names in environment variables.
- Do not silently introduce a new third-party database. The storage abstraction
  (`apps/web/src/lib/server/store/`) is currently in-memory and explicitly documented as
  non-durable — do not describe it as production-ready persistence.

## Build order
Follow `docs/CLAUDE_CODE_PLAN.md` one phase at a time. Do not jump ahead.
