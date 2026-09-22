# Claude Code Instructions

Build Cold Call Gym as a production-quality voice-first SaaS.

## Non-negotiables
- Never expose Gemini, Stripe, or Supabase service-role secrets to the browser.
- Server-side usage is the source of truth.
- Do not decrement credits only in client state.
- Use an immutable credit ledger.
- Free allowance and purchased credits are separate concepts.
- Do not store raw audio by default.
- Use Stripe-hosted payment flows.
- Validate API input.
- Add tests for quota, billing, session lifecycle, and scoring.
- Keep the mock voice provider working for CI/local development.
- Keep model names in environment variables.

## Build order
Follow `docs/CLAUDE_CODE_PLAN.md` one phase at a time. Do not jump ahead.
