-- Phase 2: usage entitlement, credit ledger, and server-side quota enforcement.
--
-- Concurrency strategy (see docs/SECURITY.md and docs/MONETIZATION.md):
--   finalize_call_usage() is the ONLY path that ever debits paid credits for
--   call usage. It runs as a single Postgres function invocation, which
--   executes inside one transaction. Inside it we:
--     1. `select ... for update` the call_sessions row, so two concurrent
--        finalize attempts for the SAME session serialize on that row lock;
--        the loser sees usage_finalized_at already set and returns the
--        existing (idempotent) result instead of recharging.
--     2. Take a session-scoped Postgres advisory lock keyed by the user id
--        (pg_advisory_xact_lock), so two concurrent finalize attempts for
--        DIFFERENT sessions belonging to the SAME user also serialize —
--        this is what prevents two simultaneous calls from both reading the
--        same "stale" paid-credit balance and overspending it.
--     3. Recompute free-seconds-used-today and paid-credit balance from the
--        ledger/session tables from inside the lock, never trusting a
--        previously-fetched balance from the caller.
--     4. Write the usage ledger row with `on conflict (idempotency_key) do
--        nothing`, which is a hard backstop against double-charging even if
--        the advisory lock were ever bypassed (e.g. a future direct SQL
--        caller) — the unique index on credit_ledger.idempotency_key makes
--        a duplicate charge impossible at the database level.
--
-- Only the `service_role` Postgres role (used exclusively by trusted
-- server-side code, never the browser) may execute finalize_call_usage.
-- Regular `authenticated`/`anon` roles are explicitly revoked below.

-- ---------------------------------------------------------------------------
-- Schema additions
-- ---------------------------------------------------------------------------

alter table public.call_sessions
  add column if not exists usage_finalized_at timestamptz,
  add column if not exists usage_idempotency_key text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'call_sessions_usage_idempotency_key_key'
  ) then
    alter table public.call_sessions
      add constraint call_sessions_usage_idempotency_key_key unique (usage_idempotency_key);
  end if;
end $$;

-- The starter schema never constrained call_sessions.state to the documented
-- state machine (created -> authorized -> connecting -> active -> ending ->
-- completed / failed). Add it now for data integrity.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'call_sessions_state_check'
  ) then
    alter table public.call_sessions
      add constraint call_sessions_state_check
      check (state in ('created','authorized','connecting','active','ending','completed','failed'));
  end if;
end $$;

create index if not exists call_sessions_user_finalized_idx
  on public.call_sessions (user_id, usage_finalized_at);

create index if not exists call_sessions_user_created_idx
  on public.call_sessions (user_id, created_at);

create index if not exists credit_ledger_user_id_idx
  on public.credit_ledger (user_id);

-- ---------------------------------------------------------------------------
-- Welcome credits: exactly one 5-credit promotional grant per user, enforced
-- by a deterministic idempotency key rather than an application-level check.
-- ---------------------------------------------------------------------------

create or replace function public.grant_welcome_credits(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted_id uuid;
begin
  insert into public.credit_ledger (user_id, transaction_type, credits_delta, idempotency_key, metadata)
  values (p_user_id, 'promotional_grant', 5, 'welcome:' || p_user_id::text, jsonb_build_object('reason', 'welcome'))
  on conflict (idempotency_key) do nothing
  returning id into v_inserted_id;

  if v_inserted_id is null then
    return 0;
  end if;
  return 5;
end;
$$;

revoke all on function public.grant_welcome_credits(uuid) from public, anon, authenticated;

-- Extend the Phase 1 signup trigger to also grant welcome credits. This is a
-- NEW migration replacing the function body (not editing 002's file), so the
-- previously-applied migration is left untouched.
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

  perform public.grant_welcome_credits(new.id);

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- finalize_call_usage: the single authoritative, atomic, idempotent usage
-- debit path. See the concurrency-strategy comment at the top of this file.
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
  paid_credits_used integer,
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
  v_paid_remaining integer;
  v_paid_seconds_needed integer;
  v_paid_used integer;
  v_ledger_inserted_id uuid;
begin
  if p_idempotency_key is null or length(trim(p_idempotency_key)) = 0 then
    raise exception 'idempotency key is required' using errcode = '22023';
  end if;

  -- Lock the session row first: two concurrent finalize calls for the SAME
  -- session serialize here, and the second sees usage_finalized_at already
  -- set below.
  select cs.user_id, cs.state, cs.usage_finalized_at, cs.created_at
    into v_user_id, v_state, v_usage_finalized_at, v_created_at
  from public.call_sessions cs
  where cs.id = p_session_id
  for update;

  if not found then
    raise exception 'call session % not found', p_session_id using errcode = 'P0002';
  end if;

  -- Serialize concurrent finalizations across ALL of this user's sessions,
  -- so two different sessions can't both read the same stale paid balance.
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
  -- wall-clock time has actually passed since the session was created. Real
  -- server-metered duration arrives with the Phase 3 voice-gateway
  -- integration; this clamp is a defense-in-depth backstop against an
  -- implausible client-reported duration in the interim.
  v_elapsed_ceiling := greatest(0, floor(extract(epoch from (now() - v_created_at)))::integer);
  v_safe_duration := greatest(0, least(coalesce(p_claimed_duration_seconds, 0), v_elapsed_ceiling));

  select coalesce(sum(cs.free_seconds_used), 0) into v_daily_free_used
  from public.call_sessions cs
  where cs.user_id = v_user_id
    and cs.usage_finalized_at is not null
    and cs.usage_finalized_at >= date_trunc('day', now() at time zone 'utc')
    and cs.id <> p_session_id;

  v_free_remaining := greatest(0, 600 - v_daily_free_used);
  v_free_used := least(v_free_remaining, v_safe_duration);

  select coalesce(sum(cl.credits_delta), 0) into v_paid_remaining
  from public.credit_ledger cl
  where cl.user_id = v_user_id;
  v_paid_remaining := greatest(0, v_paid_remaining);

  v_paid_seconds_needed := greatest(0, v_safe_duration - v_free_used);
  -- 1 credit = any started 60-second block (1s..60s = 1 credit, 61s = 2).
  v_paid_used := least(v_paid_remaining, ceil(v_paid_seconds_needed::numeric / 60)::integer);

  if v_paid_used > 0 then
    insert into public.credit_ledger (user_id, transaction_type, credits_delta, idempotency_key, metadata)
    values (v_user_id, 'usage', -v_paid_used, p_idempotency_key, jsonb_build_object('session_id', p_session_id))
    on conflict (idempotency_key) do nothing
    returning id into v_ledger_inserted_id;

    if v_ledger_inserted_id is null then
      -- A ledger row with this idempotency key already exists (a racing
      -- duplicate request). Treat as already finalized rather than
      -- double-charging.
      return query
        select cs.id, cs.state, cs.duration_seconds, cs.free_seconds_used, cs.paid_credits_used, true
        from public.call_sessions cs
        where cs.id = p_session_id;
      return;
    end if;
  end if;

  update public.call_sessions
  set state = 'completed',
      duration_seconds = v_safe_duration,
      free_seconds_used = v_free_used,
      paid_credits_used = v_paid_used,
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
