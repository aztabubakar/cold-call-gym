-- Free-plan entitlement integration tests (post business-model change).
--
-- Exercises migrations 004_free_plan_entitlement.sql and
-- 005_sales_inquiries.sql against a REAL Postgres server — these guarantees
-- (no welcome credits, daily-cap capping, RLS default-deny on
-- sales_inquiries, historical credit_ledger rows not affecting entitlement)
-- depend on Postgres locking/RLS behavior that can't be meaningfully proven
-- with pure JS unit tests.
--
-- NOT run automatically by `pnpm test` (no live Supabase/Postgres in CI).
-- To run yourself against a disposable database:
--
--   createdb ccg_test
--   psql -d ccg_test -f supabase/tests/00_stub_supabase.sql
--   psql -d ccg_test -f supabase/migrations/001_initial.sql
--   psql -d ccg_test -f supabase/migrations/002_profile_on_signup.sql
--   psql -d ccg_test -f supabase/migrations/003_entitlement_foundation.sql
--   psql -d ccg_test -f supabase/migrations/004_free_plan_entitlement.sql
--   psql -d ccg_test -f supabase/migrations/005_sales_inquiries.sql
--   psql -d ccg_test -f supabase/seed.sql
--   psql -d ccg_test -f supabase/tests/free_plan_entitlement.sql
--
-- Every case below was actually run against local PostgreSQL 16 while
-- developing this migration; see the development report for the observed
-- output.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id) values
  ('11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222222');

-- 1. New user receives 600 seconds; no welcome/promotional credits granted.
do $$
declare
  v_ledger_balance integer;
begin
  select coalesce(sum(credits_delta), 0) into v_ledger_balance
  from public.credit_ledger where user_id = '11111111-1111-1111-1111-111111111111';
  assert v_ledger_balance = 0, 'new user must receive zero credits, got ' || v_ledger_balance;
end $$;

-- 2. 0 seconds used -> 600 remaining (computed the same way
--    apps/web/src/lib/server/entitlement.ts's getEntitlement() does: sum of
--    finalized free_seconds_used for today).
do $$
declare
  v_used integer;
begin
  select coalesce(sum(free_seconds_used), 0) into v_used
  from public.call_sessions
  where user_id = '11111111-1111-1111-1111-111111111111'
    and usage_finalized_at is not null
    and usage_finalized_at >= date_trunc('day', now() at time zone 'utc');
  assert v_used = 0, 'brand new user should have 0 seconds used today';
  assert greatest(0, 600 - v_used) = 600, 'brand new user should have 600 remaining';
end $$;

-- 3. 1 second used -> 599 remaining. 599 used -> 1 remaining. 600 used -> 0
--    remaining. >600 cannot go negative. All via finalize_call_usage(),
--    which is the only thing that ever writes free_seconds_used.
insert into public.call_sessions (id, user_id, scenario_id, state, created_at)
select 'a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', id, 'active', now() - interval '20 minutes'
from public.scenarios where slug = 'busy-vp';

do $$
declare
  r record;
begin
  select * into r from public.finalize_call_usage(
    'a0000000-0000-0000-0000-000000000001', 1, 'usage:a0000000-0000-0000-0000-000000000001'
  );
  assert r.free_seconds_used = 1, 'expected 1 free second used, got ' || r.free_seconds_used;
  assert r.paid_credits_used = 0, 'paid_credits_used must always be 0, got ' || r.paid_credits_used;
end $$;

insert into public.call_sessions (id, user_id, scenario_id, state, created_at)
select 'a0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', id, 'active', now() - interval '20 minutes'
from public.scenarios where slug = 'send-email';

do $$
declare
  r record;
begin
  -- 599 more seconds would bring the day's total to 600 exactly.
  select * into r from public.finalize_call_usage(
    'a0000000-0000-0000-0000-000000000002', 599, 'usage:a0000000-0000-0000-0000-000000000002'
  );
  assert r.free_seconds_used = 599, 'expected 599 free seconds used, got ' || r.free_seconds_used;
end $$;

-- Remaining today should now be exactly 0 (1 + 599 = 600).
do $$
declare
  v_used integer;
begin
  select coalesce(sum(free_seconds_used), 0) into v_used
  from public.call_sessions
  where user_id = '11111111-1111-1111-1111-111111111111'
    and usage_finalized_at is not null
    and usage_finalized_at >= date_trunc('day', now() at time zone 'utc');
  assert v_used = 600, 'expected exactly 600 seconds used today, got ' || v_used;
  assert greatest(0, 600 - v_used) = 0, 'remaining today must be exactly 0';
end $$;

-- 4. Attempting to use MORE once already at 600: never permits negative
--    usage / never overcounts. A new session claiming 100 more seconds
--    must be capped at 0 free seconds used (nothing left today).
insert into public.call_sessions (id, user_id, scenario_id, state, created_at)
select 'a0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', id, 'active', now() - interval '20 minutes'
from public.scenarios where slug = 'not-interested';

do $$
declare
  r record;
begin
  select * into r from public.finalize_call_usage(
    'a0000000-0000-0000-0000-000000000003', 100, 'usage:a0000000-0000-0000-0000-000000000003'
  );
  assert r.free_seconds_used = 0, 'expected 0 free seconds used once daily cap reached, got ' || r.free_seconds_used;
  assert r.duration_seconds = 100, 'duration_seconds should still record the true call length, got ' || r.duration_seconds;
  assert r.paid_credits_used = 0, 'must never fall back to paid credits — there are none';
end $$;

-- 5. Yesterday's usage does not count against today's allowance.
insert into public.call_sessions (id, user_id, scenario_id, state, created_at, free_seconds_used, usage_finalized_at)
select 'a0000000-0000-0000-0000-000000000004', '22222222-2222-2222-2222-222222222222', id, 'completed', now() - interval '2 days', 600, now() - interval '1 day'
from public.scenarios where slug = 'busy-vp';

do $$
declare
  v_used_today integer;
begin
  select coalesce(sum(free_seconds_used), 0) into v_used_today
  from public.call_sessions
  where user_id = '22222222-2222-2222-2222-222222222222'
    and usage_finalized_at is not null
    and usage_finalized_at >= date_trunc('day', now() at time zone 'utc');
  assert v_used_today = 0, 'yesterday''s usage must not count toward today''s allowance, got ' || v_used_today;
end $$;

-- User 2's actual entitlement today should be the full 600, even though
-- they have a historical credit_ledger balance below (case 6) and a
-- finalized session from yesterday (case 5) — neither should reduce it.
insert into public.call_sessions (id, user_id, scenario_id, state, created_at)
select 'a0000000-0000-0000-0000-000000000005', '22222222-2222-2222-2222-222222222222', id, 'active', now() - interval '5 minutes'
from public.scenarios where slug = 'gatekeeper';

do $$
declare
  r record;
begin
  select * into r from public.finalize_call_usage(
    'a0000000-0000-0000-0000-000000000005', 30, 'usage:a0000000-0000-0000-0000-000000000005'
  );
  assert r.free_seconds_used = 30, 'user 2 should have their full 600s available today regardless of yesterday, got ' || r.free_seconds_used;
end $$;

-- 6. A historical positive credit_ledger balance does NOT increase
--    entitlement — finalize_call_usage() no longer reads credit_ledger at
--    all. Give user 2 a large historical credit balance (as if granted
--    before this migration) and confirm it has zero effect.
insert into public.credit_ledger (user_id, transaction_type, credits_delta, idempotency_key)
values ('22222222-2222-2222-2222-222222222222', 'admin_adjustment', 999, 'legacy-test-credit');

insert into public.call_sessions (id, user_id, scenario_id, state, created_at)
select 'a0000000-0000-0000-0000-000000000006', '22222222-2222-2222-2222-222222222222', id, 'active', now() - interval '20 minutes'
from public.scenarios where slug = 'price-objection';

do $$
declare
  r record;
begin
  -- User 2 has used 30s today (case 5); 570 remain. Claim 1000s: must be
  -- capped at 570, NOT extended using the 999-credit historical balance.
  select * into r from public.finalize_call_usage(
    'a0000000-0000-0000-0000-000000000006', 1000, 'usage:a0000000-0000-0000-0000-000000000006'
  );
  assert r.free_seconds_used = 570, 'historical credit_ledger balance must not increase entitlement, expected 570, got ' || r.free_seconds_used;
  assert r.paid_credits_used = 0, 'must never spend from the historical credit balance';
end $$;

-- 7. sales_inquiries: default-deny RLS. This grants table-level select AND
--    insert to `authenticated` — mirroring how Supabase configures roles by
--    default (broad table grants, RLS policies do the actual restricting)
--    — so this genuinely proves RLS itself is what blocks access, not just
--    an absent table grant.
grant select, insert on public.sales_inquiries to authenticated;

insert into public.sales_inquiries (name, work_email, company, message)
values ('Jordan Test', 'jordan@example.com', 'Example Co', 'We need 10 seats.');

do $$
declare
  v_visible integer;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
  select count(*) into v_visible from public.sales_inquiries;
  reset role;
  assert v_visible = 0, 'authenticated users must not be able to read any sales_inquiries rows via RLS, got ' || v_visible;
end $$;

do $$
begin
  begin
    set local role authenticated;
    insert into public.sales_inquiries (name, work_email, company)
    values ('Malicious User', 'attacker@example.com', 'N/A');
    reset role;
    raise exception 'authenticated role must NOT be able to insert into sales_inquiries directly, even with a table-level INSERT grant';
  exception when insufficient_privilege then
    reset role;
  end;
end $$;

rollback; -- leave the test database untouched

\echo 'All free_plan_entitlement.sql assertions passed.'
