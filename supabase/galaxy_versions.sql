-- adhdo: server-side version history for the galaxy.
--
-- Run this once in the Supabase dashboard → SQL Editor → New query → Run.
-- It is idempotent: re-running it is safe.
--
-- WHY THIS EXISTS
-- `galaxy_states` holds one row per user and every save is an UPSERT, so the
-- previous document is gone the instant the next one lands. On 2026-09-17 a
-- signed-out capture overwrote the whole galaxy and there was nothing to roll
-- back to — not because Supabase lost it, but because adhdo never kept it.
-- (Free-plan projects get no automatic daily backups at all, and even Pro's
-- are a whole-project restore to a point up to 24h stale. This is the layer
-- that actually fits a single JSON document that changes all day.)
--
-- The client writes a snapshot of the row it is ABOUT TO REPLACE — so a
-- version really is "the previous save" — whenever a write would shrink the
-- galaxy, and otherwise every few hours. A trigger prunes to the newest 20
-- per user, so this stays small however long you use it.

create table if not exists public.galaxy_versions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  state_json    jsonb not null,
  -- Denormalised so the history list can show "23 thoughts, 4 clusters"
  -- without downloading every document just to render a menu.
  glob_count    int not null default 0,
  cluster_count int not null default 0,
  -- `updated_at` of the galaxy_states row this snapshot was taken from.
  saved_at      timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists galaxy_versions_user_created_idx
  on public.galaxy_versions (user_id, created_at desc);

alter table public.galaxy_versions enable row level security;

-- Your rows, and only yours. No update policy on purpose: a version is a
-- record of what was, and nothing should be able to edit history in place.
drop policy if exists "read own versions"   on public.galaxy_versions;
drop policy if exists "insert own versions" on public.galaxy_versions;
drop policy if exists "delete own versions" on public.galaxy_versions;

create policy "read own versions" on public.galaxy_versions
  for select using (auth.uid() = user_id);
create policy "insert own versions" on public.galaxy_versions
  for insert with check (auth.uid() = user_id);
create policy "delete own versions" on public.galaxy_versions
  for delete using (auth.uid() = user_id);

-- Keep the newest 20 per user. In the database rather than the client because
-- a client that crashes mid-save must not be able to leave history unbounded,
-- and because a second device shouldn't need to know how many the first kept.
create or replace function public.prune_galaxy_versions()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.galaxy_versions
  where user_id = new.user_id
    and id not in (
      select id from public.galaxy_versions
      where user_id = new.user_id
      order by created_at desc, id desc
      limit 20
    );
  return null;
end;
$$;

drop trigger if exists prune_galaxy_versions_after_insert on public.galaxy_versions;
create trigger prune_galaxy_versions_after_insert
  after insert on public.galaxy_versions
  for each row execute function public.prune_galaxy_versions();
