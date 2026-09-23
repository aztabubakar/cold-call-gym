# Legacy: Supabase (archived, not part of the active application)

Cold Call Gym no longer uses Supabase, accounts, or any database. This
directory is kept only as a historical record of the earlier
account-based, Postgres-backed architecture (Phases 1-3 plus the
free-plan-only pivot that followed) — see `docs/CLAUDE_CODE_PLAN.md` for
that history.

Nothing in `apps/web` or `services/voice-gateway` reads from or writes to
these migrations anymore. The current lead-gated, no-account architecture
uses an in-memory storage abstraction instead — see
`apps/web/src/lib/server/store/` and `docs/ARCHITECTURE.md`.

Do not apply these migrations against a live project as part of normal
operation; they describe a schema the running application no longer uses.
This directory is not deployed by any GitHub Actions workflow (the old
`supabase-deploy.yml`/`supabase-seed.yml` workflows were removed).
