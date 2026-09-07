-- Survivor league picks: one pick per user per NFL week, and a team can only
-- be used once per season.
--
-- This table was originally created ad hoc with no migration in the repo.
-- Documented here so the schema is reproducible. The canonical team columns
-- are team_abbrev / team_name.

create table if not exists public.survivor_picks (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  -- Calendar year the NFL season kicked off in. Jan/Feb playoff games belong
  -- to the previous year's season.
  season_year int not null,
  week_number int not null,
  game_id text not null,
  team_abbrev text not null,
  team_name text not null,
  -- Moneyline for the picked team at the time of the pick, when available.
  moneyline int,
  result text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Required by the upsert's onConflict target:
--   { onConflict: "competition_id,user_id,week_number" }
create unique index if not exists survivor_picks_unique_week
  on public.survivor_picks(competition_id, user_id, week_number);

create index if not exists survivor_picks_competition_idx
  on public.survivor_picks(competition_id);

-- All access is via the server-side admin client, so RLS stays on with no
-- permissive policies — same approach as pool picks.
alter table public.survivor_picks enable row level security;

-- ─────────────────────────────────────────────────────────────────────────
-- Cleanup: an earlier version of this migration added picked_team_abbrev /
-- picked_team_name, duplicating team_abbrev / team_name. They are nullable
-- and unused — drop them so there's one obvious place the team lives.
-- ─────────────────────────────────────────────────────────────────────────
alter table public.survivor_picks
  drop column if exists picked_team_abbrev,
  drop column if exists picked_team_name;
