-- Migration: Over/Under picks support
-- Run in Supabase SQL editor.

-- 1. Add draft_style to competitions (safe if already exists)
alter table public.competitions
  add column if not exists draft_style text
    check (draft_style in ('standard', 'balanced')) default 'standard';

-- 2. Add enable_over_under flag to competitions
alter table public.competitions
  add column if not exists enable_over_under boolean not null default false;

-- 3. Add pick_type, over_under_choice, and total_line to picks
alter table public.picks
  add column if not exists pick_type text
    check (pick_type in ('winner', 'over_under')) default 'winner';

alter table public.picks
  add column if not exists over_under_choice text
    check (over_under_choice in ('over', 'under'));

-- Store the line at pick time so we don't need to re-look it up when scoring.
alter table public.picks
  add column if not exists total_line numeric(4,1);

-- 4. Game lines table — one row per NHL game per day, frozen at fetch time.
create table if not exists public.game_lines (
  id         uuid primary key default gen_random_uuid(),
  game_id    bigint   not null,
  game_date  date     not null,
  total_line numeric(4,1) not null,
  home_team  text,
  away_team  text,
  fetched_at timestamptz default now(),
  unique(game_id, game_date)
);

alter table public.game_lines enable row level security;

-- Authenticated users can read lines (needed for the pick room).
create policy "game_lines readable" on public.game_lines
  for select using (auth.role() = 'authenticated');
