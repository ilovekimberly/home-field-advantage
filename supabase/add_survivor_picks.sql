-- Survivor league picks.
--
-- Survivor is week-based rather than date-based: one pick per user per NFL
-- week, and a team can only be used once for the whole season. That doesn't
-- fit public.picks (which is keyed by game_date + game_id), so survivor picks
-- live in their own table.
--
-- This table had no migration in the repo — it was created ad hoc, which is
-- why picked_team_abbrev was missing and inserts failed with
-- "Could not find the 'picked_team_abbrev' column ... in the schema cache".
-- Written to be safe to run against either a missing or a partial table.

create table if not exists public.survivor_picks (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  -- Calendar year the NFL season kicked off in. Jan/Feb playoff games belong
  -- to the previous year's season.
  season_year int not null,
  -- NFL week number as reported by the schedule API.
  week_number int not null,
  picked_team_abbrev text not null,
  picked_team_name text not null,
  -- 'pending' until the game finishes; 'unscored' when it can't be resolved.
  result text check (result in ('win','loss','pending','unscored')) default 'pending',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Backfill columns for an existing partial table.
alter table public.survivor_picks
  add column if not exists competition_id uuid references public.competitions(id) on delete cascade,
  add column if not exists user_id uuid references public.profiles(id) on delete cascade,
  add column if not exists season_year int,
  add column if not exists week_number int,
  add column if not exists picked_team_abbrev text,
  add column if not exists picked_team_name text,
  add column if not exists result text default 'pending',
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

-- Required by the upsert's onConflict target:
--   { onConflict: "competition_id,user_id,week_number" }
-- Without this the upsert fails even once the columns exist.
create unique index if not exists survivor_picks_unique_week
  on public.survivor_picks(competition_id, user_id, week_number);

create index if not exists survivor_picks_competition_idx
  on public.survivor_picks(competition_id);

-- All reads and writes go through the admin client (server-side routes), so
-- RLS stays on with no permissive policies — matching how pool picks are
-- handled elsewhere in the app.
alter table public.survivor_picks enable row level security;
