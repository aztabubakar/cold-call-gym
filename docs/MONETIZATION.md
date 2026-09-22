# Monetization

## Free plan
Suggested launch:
- 10 minutes/day
- basic coaching
- limited starter scenarios

## Paid credits
Sell understandable voice minutes, not LLM tokens.
- 1 credit = 60 seconds
- consume free allowance first
- never allow negative balance
- keep immutable ledger

## Ledger transaction types
purchase, usage, refund, promotional_grant, admin_adjustment, expiration

## Stripe flow
1. Server creates Checkout Session.
2. User pays on Stripe.
3. Stripe webhook arrives.
4. Verify signature.
5. Store event idempotently.
6. Add ledger credit.
7. UI reads updated balance.

Never grant credits from the browser success redirect alone.
