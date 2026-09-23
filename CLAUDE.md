# Claude Code Instructions

Build Cold Call Gym as a production-quality voice-first SaaS.

## Business model
Free individual access only: every authenticated user gets 10 minutes
(600 seconds) of AI voice practice per UTC calendar day, no rollover. There
is **no self-service payment flow** — no purchased credits, no
subscriptions, no Stripe integration. Teams or individuals who need more
than the free daily allowance use the Contact Sales form
(`/contact-sales`). See `docs/MONETIZATION.md`.

## Non-negotiables
- Never expose Gemini or Supabase service-role secrets to the browser.
- Server-side usage is the source of truth.
- Do not compute or enforce entitlement in client state.
- The Voice Gateway is authoritative for call duration (its own monotonic
  clock); the browser's countdown is presentation only.
- Do not store raw audio by default.
- Validate API input, including the Contact Sales form.
- Add tests for quota, session lifecycle, and scoring.
- Keep the mock voice provider working for CI/local development.
- Keep model names in environment variables.

## Build order
Follow `docs/CLAUDE_CODE_PLAN.md` one phase at a time. Do not jump ahead.
