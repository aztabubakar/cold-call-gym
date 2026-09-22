# Architecture

Browser ↔ Next.js web app ↔ Supabase
              |
              └── signed voice session token
                       |
                       v
                Voice Gateway
                       |
                       v
                 Gemini Live

## Web responsibilities
- auth
- dashboard
- scenarios
- billing UI
- call history
- coaching report UI
- create short-lived voice authorization

## Voice gateway responsibilities
- validate user/session
- load scenario/persona
- check entitlement
- connect to Gemini Live
- relay audio
- meter time server-side
- terminate when quota is exhausted
- finalize usage
- write session outcome

## Call states
created → authorized → connecting → active → ending → completed
                                              ↘ failed

## Why separate voice gateway?
Real-time audio is long-lived and stateful. A dedicated gateway is easier to operate than a short-lived serverless handler.
