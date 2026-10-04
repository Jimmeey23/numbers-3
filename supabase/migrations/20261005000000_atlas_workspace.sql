-- Per-user Atlas workspace state and generated analytical content.
create table if not exists public.atlas_user_state (
  user_id uuid not null references auth.users(id) on delete cascade,
  state_key text not null check (length(state_key) between 1 and 160),
  value jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, state_key)
);

create table if not exists public.atlas_ai_cache (
  user_id uuid not null references auth.users(id) on delete cascade,
  fingerprint text not null check (length(fingerprint) between 16 and 128),
  kind text not null check (kind in ('signals', 'report')),
  tab text,
  scope_month text not null check (scope_month ~ '^[0-9]{4}-[0-9]{2}$'),
  locations text[] not null default '{}',
  content jsonb not null,
  generated_at timestamptz not null default now(),
  primary key (user_id, fingerprint)
);
create index if not exists atlas_ai_cache_scope_idx on public.atlas_ai_cache (user_id, scope_month, kind);

create table if not exists public.atlas_reports (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  fingerprint text not null,
  report jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);
create index if not exists atlas_reports_fingerprint_idx on public.atlas_reports (user_id, fingerprint, created_at desc);

alter table public.atlas_user_state enable row level security;
alter table public.atlas_ai_cache enable row level security;
alter table public.atlas_reports enable row level security;

create policy "Atlas state belongs to its user" on public.atlas_user_state
  for all to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "Atlas AI cache belongs to its user" on public.atlas_ai_cache
  for all to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "Atlas reports belong to its user" on public.atlas_reports
  for all to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.atlas_user_state, public.atlas_ai_cache, public.atlas_reports to authenticated;
