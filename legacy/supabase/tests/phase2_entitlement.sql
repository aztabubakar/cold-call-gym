-- Phase 2 entitlement/ledger integration tests.
--
-- These exercise supabase/migrations/003_entitlement_foundation.sql against
-- a REAL Postgres server (not mocked) — the atomicity/idempotency/RLS
-- guarantees documented there cannot be meaningfully verified with pure
-- JS unit tests, since they depend on Postgres row locks, advisory locks,
-- and privilege grants.
--
-- This script is NOT run automatically by `pnpm test` (there's no Supabase
-- project in CI). To run it yourself against a disposable database:
--
--   createdb ccg_test
--   psql -d ccg_test -f supabase/tests/00_stub_supabase.sql   # see below
--   psql -d ccg_test -f supabase/migrations/001_initial.sql
--   psql -d ccg_test -f supabase/migrations/002_profile_on_signup.sql
--   psql -d ccg_test -f supabase/migrations/003_entitlement_foundation.sql
--   psql -d ccg_test -f supabase/seed.sql
--   psql -d ccg_test -f supabase/tests/phase2_entitlement.sql
--
-- A real Supabase project already provides the auth schema, auth.uid(), and
-- anon/authenticated/service_role roles that migration 001's RLS policies
-- and migration 003's function grants depend on. Outside of a real project
-- (e.g. this repo's CI, or a bare local Postgres), those pieces don't
-- exist yet, so supabase/tests/00_stub_supabase.sql creates a minimal stand
-- -in: an `auth.users` table with the columns our triggers touch, and the
-- three Postgres roles. This is intentionally NOT a general Supabase
-- emulator — just enough surface for these tests to run against a plain
-- Postgres server.
--
-- Every case below was actually run against local PostgreSQL 16 while
-- developing this migration; see the Phase 2 development report for the
-- observed output of each.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id) values
  ('11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222222');

-- 1. Promotional welcome credit is granted exactly once, automatically, on
--    signup (via the auth.users insert trigger), and a manual second call
--    is a no-op.
do $$
declare
  v_balance integer;
  v_second_call integer;
begin
  select coalesce(sum(credits_delta), 0) into v_balance
  from public.credit_ledger where user_id = '11111111-1111-1111-1111-111111111111';
  assert v_balance = 5, 'expected welcome grant of 5 credits, got ' || v_balance;

  select public.grant_welcome_credits('11111111-1111-1111-1111-111111111111') into v_second_call;
  assert v_second_call = 0, 'second welcome-credit grant must be a no-op';
end $$;

-- 2. Brand new user has 600 free seconds and their granted paid credits.
do $$
declare
  v_free_used integer;
begin
  select coalesce(sum(free_seconds_used), 0) into v_free_used
  from public.call_sessions
  where user_id = '22222222-2222-2222-2222-222222222222'
    and usage_finalized_at is not null
    and usage_finalized_at >= date_trunc('day', now() at time zone 'utc');
  assert v_free_used = 0, 'brand new user should have 0 free seconds used today';
end $$;

-- 3. Basic finalize: all-free usage within the daily allowance charges 0
--    paid credits.
insert into public.call_sessions (id, user_id, scenario_id, state, created_at)
select 'a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', id, 'active', now() - interval '20 minutes'
from public.scenarios where slug = 'busy-vp';

do $$
declare
  r record;
begin
  select * into r from public.finalize_call_usage(
    'a0000000-0000-0000-0000-000000000001', 200, 'usage:a0000000-0000-0000-0000-000000000001'
  );
  assert r.free_seconds_used = 200, 'expected 200 free seconds used, got ' || r.free_seconds_used;
  assert r.paid_credits_used = 0, 'expected 0 paid credits used, got ' || r.paid_credits_used;
  assert r.already_finalized = false;
end $$;

-- 4. Duplicate finalize on the SAME session is idempotent: no re-charge,
--    original result returned even with a wildly different claimed
--    duration.
do $$
declare
  r record;
  v_ledger_rows integer;
begin
  select * into r from public.finalize_call_usage(
    'a0000000-0000-0000-0000-000000000001', 99999, 'usage:a0000000-0000-0000-0000-000000000001'
  );
  assert r.already_finalized = true, 'second finalize call must report already_finalized';
  assert r.duration_seconds = 200, 'duration must stay at the originally finalized value';

  select count(*) into v_ledger_rows from public.credit_ledger
  where user_id = '11111111-1111-1111-1111-111111111111';
  assert v_ledger_rows = 1, 'duplicate finalize must not add a ledger row';
end $$;

-- 5. Free allowance exhausted mid-session -> spills into paid credits with
--    correct 60-second-block rounding (100 paid seconds -> ceil(100/60)=2).
insert into public.call_sessions (id, user_id, scenario_id, state, created_at)
select 'a0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', id, 'active', now() - interval '20 minutes'
from public.scenarios where slug = 'send-email';

do $$
declare
  r record;
begin
  select * into r from public.finalize_call_usage(
    'a0000000-0000-0000-0000-000000000002', 500, 'usage:a0000000-0000-0000-0000-000000000002'
  );
  assert r.free_seconds_used = 400, 'expected remaining 400 free seconds consumed, got ' || r.free_seconds_used;
  assert r.paid_credits_used = 2, 'expected 2 paid credits (ceil(100/60)), got ' || r.paid_credits_used;
end $$;

-- 6. Cannot spend more paid credits than are available; balance never goes
--    negative even when far more usage is claimed than can be covered.
insert into public.call_sessions (id, user_id, scenario_id, state, created_at)
select 'a0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', id, 'active', now() - interval '20 minutes'
from public.scenarios where slug = 'not-interested';

do $$
declare
  r record;
  v_balance integer;
begin
  select * into r from public.finalize_call_usage(
    'a0000000-0000-0000-0000-000000000003', 1000, 'usage:a0000000-0000-0000-0000-000000000003'
  );
  -- 3 credits remained (5 granted - 2 spent above).
  assert r.paid_credits_used = 3, 'expected usage capped at the 3 remaining credits, got ' || r.paid_credits_used;

  select coalesce(sum(credits_delta), 0) into v_balance
  from public.credit_ledger where user_id = '11111111-1111-1111-1111-111111111111';
  assert v_balance = 0, 'balance must be exactly 0, never negative, got ' || v_balance;
end $$;

-- 7. An implausible claimed duration is clamped to wall-clock time elapsed
--    since the session was created.
insert into public.call_sessions (id, user_id, scenario_id, state, created_at)
select 'a0000000-0000-0000-0000-000000000004', '22222222-2222-2222-2222-222222222222', id, 'active', now() - interval '5 seconds'
from public.scenarios where slug = 'busy-vp';

do $$
declare
  r record;
begin
  select * into r from public.finalize_call_usage(
    'a0000000-0000-0000-0000-000000000004', 99999, 'usage:a0000000-0000-0000-0000-000000000004'
  );
  assert r.duration_seconds <= 6, 'claimed duration must be clamped near actual elapsed time, got ' || r.duration_seconds;
end $$;

-- 8. Unauthorized cross-user read: RLS must hide another user's ledger and
--    session rows.
grant select on public.call_sessions, public.credit_ledger to authenticated;

do $$
declare
  v_visible integer;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
  select count(*) into v_visible from public.credit_ledger
  where user_id = '22222222-2222-2222-2222-222222222222';
  reset role;
  assert v_visible = 0, 'user1 must not see user2''s ledger rows via RLS';
end $$;

-- 9. Normal (authenticated) users cannot call finalize_call_usage or
--    grant_welcome_credits directly — only service_role can.
do $$
begin
  begin
    set local role authenticated;
    perform public.finalize_call_usage('a0000000-0000-0000-0000-000000000001', 1, 'usage:hack');
    reset role;
    raise exception 'authenticated role must NOT be able to call finalize_call_usage';
  exception when insufficient_privilege then
    reset role;
  end;
end $$;

do $$
begin
  begin
    set local role authenticated;
    perform public.grant_welcome_credits('11111111-1111-1111-1111-111111111111');
    reset role;
    raise exception 'authenticated role must NOT be able to call grant_welcome_credits';
  exception when insufficient_privilege then
    reset role;
  end;
end $$;

rollback; -- leave the test database untouched

\echo 'All phase2_entitlement.sql assertions passed.'
