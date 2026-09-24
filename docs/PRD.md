# Product Requirements

## Vision
Make cold-call practice as repeatable as a gym workout: realistic voice reps, immediate evidence-based coaching, measurable progress.

## Primary users
- SDRs / BDRs
- Account executives
- founders
- real-estate agents
- recruiters
- insurance sales reps

## MVP journey
1. Land on the homepage, click "Start Practicing Free"
2. Submit name, email, and phone at `/start` (no password, no email verification)
3. Get instant access — no account created, nothing to confirm
4. Choose scenario
5. Choose/randomize prospect
6. Start call
7. Speak naturally with AI prospect
8. End call whenever ready — practice is free and unlimited
9. Get coaching
10. Practice again anytime, or contact sales for team/enterprise needs

## Starter scenarios
- Busy executive
- "Send me an email"
- "Not interested"
- "We already use a competitor"
- Gatekeeper
- Price objection

## Free access (MVP)
- No account, no password, no email verification — name + email + phone at `/start` grants
  immediate access via an opaque access-session cookie
- 10 free voice minutes per UTC day, per access identity, no rollover
- no purchased credits, no subscriptions, no self-service payment
- teams/individuals needing more contact sales (`/contact-sales`)

## Non-goals for MVP
- real outbound dialing
- CRM integrations
- accounts, passwords, or email/phone verification (see `docs/SECURITY.md` for what this trades
  away, and how it could be hardened later without redesigning the voice session architecture)
- enterprise SSO
- calling real people
- self-service payments, purchased credits, or subscriptions (Contact Sales
  is the only path to expanded access)
- a durable production datastore (the current storage is in-memory and explicitly not durable —
  see `docs/DEPLOYMENT.md`)
