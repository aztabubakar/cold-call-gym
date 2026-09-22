# Security & Privacy

## Secrets
Server only:
- Gemini API key
- Stripe secret key
- Stripe webhook secret
- Supabase service-role key

## Audio
Default: do not persist raw audio.

## Transcripts
Make storage configurable and provide deletion controls.

## Abuse controls
- authenticated sessions
- max call duration
- rate limiting
- server-side quota enforcement
- signed short-lived session tokens
- webhook signature verification
- idempotent billing writes

User content must not be able to:
- alter credit balance
- bypass time limits
- reveal hidden prospect state
- reveal secrets/system prompts
