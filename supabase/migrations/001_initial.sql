create extension if not exists pgcrypto;

create table if not exists public.profiles(
 id uuid primary key references auth.users(id) on delete cascade,
 display_name text,
 company_name text,
 role text,
 created_at timestamptz not null default now()
);

create table if not exists public.scenarios(
 id uuid primary key default gen_random_uuid(),
 slug text not null unique,
 name text not null,
 description text not null,
 difficulty text not null check(difficulty in('practice','realistic','challenge')),
 objective text not null,
 prospect_role text not null,
 prospect_company text not null,
 persona jsonb not null default '{}'::jsonb,
 hidden_state jsonb not null default '{}'::jsonb,
 target_duration_seconds integer not null default 300,
 is_active boolean not null default true,
 created_at timestamptz not null default now()
);

create table if not exists public.call_sessions(
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 scenario_id uuid not null references public.scenarios(id),
 state text not null,
 started_at timestamptz,
 ended_at timestamptz,
 duration_seconds integer not null default 0,
 free_seconds_used integer not null default 0,
 paid_credits_used integer not null default 0,
 transcript jsonb,
 created_at timestamptz not null default now()
);

create table if not exists public.credit_ledger(
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 transaction_type text not null,
 credits_delta integer not null,
 external_reference text,
 idempotency_key text unique,
 metadata jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);

create table if not exists public.coaching_reports(
 id uuid primary key default gen_random_uuid(),
 session_id uuid not null unique references public.call_sessions(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 overall_summary text not null,
 category_scores jsonb not null,
 strengths jsonb not null default '[]'::jsonb,
 improvements jsonb not null default '[]'::jsonb,
 next_drill text,
 evidence jsonb not null default '[]'::jsonb,
 created_at timestamptz not null default now()
);

create table if not exists public.stripe_events(
 event_id text primary key,
 event_type text not null,
 processed_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.scenarios enable row level security;
alter table public.call_sessions enable row level security;
alter table public.credit_ledger enable row level security;
alter table public.coaching_reports enable row level security;

create policy "profiles own row" on public.profiles for all using(auth.uid()=id) with check(auth.uid()=id);
create policy "active scenarios readable" on public.scenarios for select using(is_active=true);
create policy "users read own sessions" on public.call_sessions for select using(auth.uid()=user_id);
create policy "users read own ledger" on public.credit_ledger for select using(auth.uid()=user_id);
create policy "users read own reports" on public.coaching_reports for select using(auth.uid()=user_id);
