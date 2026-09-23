-- "Contact Sales" — the only path to expanded access beyond the free daily
-- allowance, since there is no self-service payment flow.
--
-- Access model: RLS is enabled with NO policies for anon/authenticated, so
-- both roles get the default-deny behavior for every operation (select,
-- insert, update, delete) — a visitor/user cannot read, insert, or modify
-- sales_inquiries rows directly via the Supabase client with the anon/user
-- session key. The only writer is the service-role client used from
-- POST /api/contact-sales (apps/web/src/app/api/contact-sales/route.ts),
-- which runs entirely server-side and never exposes the service-role key to
-- the browser. There is intentionally no SELECT policy for any non-service
-- role either, including the submitter themselves — inquiries are read only
-- by trusted server-side/admin tooling.

create table if not exists public.sales_inquiries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  name text not null check (length(name) between 1 and 200),
  work_email text not null check (length(work_email) between 3 and 320),
  company text not null check (length(company) between 1 and 200),
  job_title text check (job_title is null or length(job_title) <= 200),
  team_size text check (team_size is null or length(team_size) <= 100),
  phone text check (phone is null or length(phone) <= 50),
  expected_usage text check (expected_usage is null or length(expected_usage) <= 500),
  message text check (message is null or length(message) <= 4000),
  status text not null default 'new' check (status in ('new', 'contacted', 'qualified', 'closed')),
  created_at timestamptz not null default now()
);

create index if not exists sales_inquiries_created_at_idx
  on public.sales_inquiries (created_at desc);

alter table public.sales_inquiries enable row level security;
-- No policies added: default-deny for anon and authenticated on every
-- operation. Only the service-role key (server-only) can read or write.
