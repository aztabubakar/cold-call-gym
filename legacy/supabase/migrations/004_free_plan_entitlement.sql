-- Business model change: Cold Call Gym has NO paid credits, NO purchased
-- overflow, NO subscriptions, and NO Stripe integration. Every authenticated
-- user gets a single free daily allowance (600 seconds / 10 minutes per UTC
-- calendar day, no rollover); teams that need more contact sales instead of
-- self-service checkout.
--
-- This is a NEW, forward-only migration. Migrations 001-003 are NOT edited
-- (they may already be applied against the hosted project). Tables/columns
-- tied to the old credit model — credit_ledger, and
-- call_sessions.paid_credits_used — are intentionally left in the schema
-- rather than dropped: dropping them buys nothing and only adds risk against
-- a live database. They are LEGACY/DEPRECATED as of this migration:
--   - credit_ledger: no longer read or written by any application code or
--     database function. Historical rows (if any) are left untouched.
--   - call_sessions.paid_credits_used: finalize_call_usage() below always
--     writes 0 into it now. Kept only so the column/function return shape
--     doesn't need to change everywhere that reads it.
--   - public.grant_welcome_credits(uuid): no longer called by anything
--     (see the handle_new_user() replacement below). Left in place, still
--     locked down to service_role only (unchanged from 003).

-- ---------------------------------------------------------------------------
-- 1. Stop granting welcome/promotional credits at signup.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, new.raw_user_meta_data ->> 'display_name')
  on conflict (id) do nothing;

  -- Free-plan-only model: no welcome/promotional credits are granted.
  -- (Previously called public.grant_welcome_credits(new.id) here.)
  return new;
end;
$$;

comment on function public.grant_welcome_credits(uuid) is
  'LEGACY/DEPRECATED: no longer called anywhere as of 004_free_plan_entitlement.sql. Cold Call Gym has no paid or promotional credits. Kept in place (rather than dropped) only to avoid unnecessary schema churn against a live database.';

comment on table public.credit_ledger is
  'LEGACY/DEPRECATED: no longer read or written by any application code or database function as of 004_free_plan_entitlement.sql. Cold Call Gym has no paid credits. Kept in place only to avoid dropping a table with potential historical rows.';

comment on column public.call_sessions.paid_credits_used is
  'LEGACY/DEPRECATED: always 0 as of 004_free_plan_entitlement.sql. Cold Call Gym has no paid credits.';

-- ---------------------------------------------------------------------------
-- 2. Finalization no longer touches credit_ledger or deducts credits.
--
--    Concurrency strategy (unchanged from 003, still necessary): even with
--    no paid overflow, two sessions belonging to the same user could still
--    be authorized concurrently (e.g. two browser tabs) and both be active
--    at once. finalize_call_usage() still takes a `for update` lock on the
--    session row (serializes duplicate finalize calls for the SAME session)
--    and a per-user pg_advisory_xact_lock (serializes concurrent finalize
--    calls across DIFFERENT sessions for the SAME user), then recomputes
--    today's free-seconds-used from scratch inside that lock before ever
--    writing free_seconds_used — this is what stops two concurrently-active
--    calls from together overcounting past the 600-second daily allowance.
--
--    Return shape is UNCHANGED from 003 (paid_credits_used stays in the
--    result, always 0 now) so this can use CREATE OR REPLACE rather than
--    DROP + CREATE FUNCTION, and so no calling code needs to change how it
--    parses the result.
-- ---------------------------------------------------------------------------
create or replace function public.finalize_call_usage(
  p_session_id uuid,
  p_claimed_duration_seconds integer,
  p_idempotency_key text
)
returns table (
  session_id uuid,
  state text,
  duration_seconds integer,
  free_seconds_used integer,
  paid_credits_used integer, -- LEGACY/DEPRECATED: always 0 in the free-only model.
  already_finalized boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_state text;
  v_usage_finalized_at timestamptz;
  v_created_at timestamptz;
  v_safe_duration integer;
  v_elapsed_ceiling integer;
  v_daily_free_used integer;
  v_free_remaining integer;
  v_free_used integer;
begin
  if p_idempotency_key is null or length(trim(p_idempotency_key)) = 0 then
    raise exception 'idempotency key is required' using errcode = '22023';
  end if;

  -- Lock the session row first: two concurrent finalize calls for the SAME
  -- session serialize here, and the second sees usage_finalized_at already
  -- set below (idempotent no-op, not a double-count).
  select cs.user_id, cs.state, cs.usage_finalized_at, cs.created_at
    into v_user_id, v_state, v_usage_finalized_at, v_created_at
  from public.call_sessions cs
  where cs.id = p_session_id
  for update;

  if not found then
    raise exception 'call session % not found', p_session_id using errcode = 'P0002';
  end if;

  -- Serialize concurrent finalizations across ALL of this user's sessions,
  -- so two different (concurrently active) sessions can't both read the
  -- same stale "used today" figure and together exceed the daily allowance.
  perform pg_advisory_xact_lock(hashtext(v_user_id::text));

  if v_usage_finalized_at is not null then
    return query
      select cs.id, cs.state, cs.duration_seconds, cs.free_seconds_used, cs.paid_credits_used, true
      from public.call_sessions cs
      where cs.id = p_session_id;
    return;
  end if;

  if v_state = 'failed' or v_state = 'created' then
    raise exception 'session % in state % is not eligible for usage finalization', p_session_id, v_state
      using errcode = 'P0001';
  end if;

  -- Trusted server data only: clamp the claimed duration to how much
  -- wall-clock time has actually passed since the session was created —
  -- defense in depth against an implausible caller-supplied duration, on
  -- top of the voice gateway's own monotonic timer already being the real
  -- source of p_claimed_duration_seconds.
  v_elapsed_ceiling := greatest(0, floor(extract(epoch from (now() - v_created_at)))::integer);
  v_safe_duration := greatest(0, least(coalesce(p_claimed_duration_seconds, 0), v_elapsed_ceiling));

  select coalesce(sum(cs.free_seconds_used), 0) into v_daily_free_used
  from public.call_sessions cs
  where cs.user_id = v_user_id
    and cs.usage_finalized_at is not null
    and cs.usage_finalized_at >= date_trunc('day', now() at time zone 'utc')
    and cs.id <> p_session_id;

  v_free_remaining := greatest(0, 600 - v_daily_free_used);

  -- Never deducts credits (there are none), never permits negative usage:
  -- the amount that counts against today's allowance is capped at what's
  -- left of it. If the actual call ran longer than that — only possible via
  -- a race between two concurrently-authorized sessions for the same user —
  -- duration_seconds still records the true call length, but
  -- free_seconds_used (the only thing that affects entitlement) stays
  -- capped, and no overflow is charged anywhere.
  v_free_used := least(v_free_remaining, v_safe_duration);

  update public.call_sessions
  set state = 'completed',
      duration_seconds = v_safe_duration,
      free_seconds_used = v_free_used,
      paid_credits_used = 0,
      ended_at = now(),
      usage_finalized_at = now(),
      usage_idempotency_key = p_idempotency_key
  where id = p_session_id;

  return query
    select cs.id, cs.state, cs.duration_seconds, cs.free_seconds_used, cs.paid_credits_used, false
    from public.call_sessions cs
    where cs.id = p_session_id;
end;
$$;

revoke all on function public.finalize_call_usage(uuid, integer, text) from public, anon, authenticated;
grant execute on function public.finalize_call_usage(uuid, integer, text) to service_role;
