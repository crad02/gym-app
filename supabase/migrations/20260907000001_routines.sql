-- Gym App — routines
-- A routine is a saved running order of exercises ("Push A"), authored by the
-- user or adopted from a starter template. The app writes them; nothing else
-- does. Same offline-first shape as workouts: localStorage is the source of
-- truth on-device and this table is the copy that survives a new phone.
--
-- Deliberately NOT a foreign key to anything: a routine references exercises by
-- the app's local exId, which is per-device and rebuilt on restore from the
-- name carried in the payload. Keeping it opaque JSONB means the app can change
-- the routine shape without a migration, exactly as it does for workouts.

create table if not exists public.routines (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  client_id   text not null,                 -- the app's local uid(); idempotency key
  payload     jsonb not null,                -- { name, note, exercises:[{exId,name,muscle,sets,reps}], … }
  updated_at  timestamptz not null default now(),
  unique (user_id, client_id)                -- re-sync UPSERTs, never duplicates
);

create index if not exists routines_user_idx on public.routines (user_id);

-- reuse the trigger function defined in the initial migration
drop trigger if exists routines_touch_updated_at on public.routines;
create trigger routines_touch_updated_at
  before update on public.routines
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row-Level Security — a user fully owns their own routines, same as workouts.
-- ---------------------------------------------------------------------------
alter table public.routines enable row level security;

create policy routines_select_own on public.routines
  for select using (auth.uid() = user_id);
create policy routines_insert_own on public.routines
  for insert with check (auth.uid() = user_id);
create policy routines_update_own on public.routines
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy routines_delete_own on public.routines
  for delete using (auth.uid() = user_id);
