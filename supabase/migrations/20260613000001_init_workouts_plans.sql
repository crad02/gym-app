-- Gym App ↔ Lab — initial schema
-- workouts: app writes (offline-first sync) → lab reads (incremental ingest)
-- plans:    lab writes (service role) → app reads (Coach tab)
-- Security: Row-Level Security so each signed-in user only ever touches their own
-- rows. The lab connects with the service_role key, which bypasses RLS by design.

-- ---------------------------------------------------------------------------
-- workouts
-- One row per workout; payload mirrors the app's localStorage shape as JSONB so
-- the app rewrite stays minimal and the lab flattens it like loaders/liftlog.py.
-- ---------------------------------------------------------------------------
create table if not exists public.workouts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  client_id   text not null,                 -- the app's local uid(); idempotency key
  date        date not null,
  payload     jsonb not null,                -- { entries:[{exId,name,sets:[{type,weight,reps}]}] }
  updated_at  timestamptz not null default now(),
  unique (user_id, client_id)                -- re-sync UPSERTs, never duplicates
);

create index if not exists workouts_user_date_idx on public.workouts (user_id, date);

-- ---------------------------------------------------------------------------
-- plans
-- The muscle-group-keyed coach plan. App reads the latest WHERE active.
-- ---------------------------------------------------------------------------
create table if not exists public.plans (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  generated_at  timestamptz not null default now(),
  active        boolean not null default true,
  plan          jsonb not null               -- { groups:{ Back:{priority,focus[],why}, ... } }
);

create index if not exists plans_user_active_idx on public.plans (user_id, active);

-- keep updated_at honest on UPSERT
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists workouts_touch_updated_at on public.workouts;
create trigger workouts_touch_updated_at
  before update on public.workouts
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------
alter table public.workouts enable row level security;
alter table public.plans    enable row level security;

-- workouts: a user fully owns their own rows
create policy workouts_select_own on public.workouts
  for select using (auth.uid() = user_id);
create policy workouts_insert_own on public.workouts
  for insert with check (auth.uid() = user_id);
create policy workouts_update_own on public.workouts
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy workouts_delete_own on public.workouts
  for delete using (auth.uid() = user_id);

-- plans: a user can READ their own plans; writes are lab-only (service role,
-- which bypasses RLS) so no insert/update/delete policy is granted to clients.
create policy plans_select_own on public.plans
  for select using (auth.uid() = user_id);
