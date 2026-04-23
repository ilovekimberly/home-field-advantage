-- Migration: moneyline odds, spread picks, and odds on totals
-- Run in Supabase SQL Editor.

-- 1. game_lines: add odds and spread columns
ALTER TABLE public.game_lines
  ADD COLUMN IF NOT EXISTS home_ml        integer,
  ADD COLUMN IF NOT EXISTS away_ml        integer,
  ADD COLUMN IF NOT EXISTS over_odds      integer,
  ADD COLUMN IF NOT EXISTS under_odds     integer,
  ADD COLUMN IF NOT EXISTS home_spread    numeric(4,1),
  ADD COLUMN IF NOT EXISTS away_spread    numeric(4,1),
  ADD COLUMN IF NOT EXISTS home_spread_odds integer,
  ADD COLUMN IF NOT EXISTS away_spread_odds integer;

-- 2. picks: extend pick_type to allow 'spread'
ALTER TABLE public.picks DROP CONSTRAINT IF EXISTS picks_pick_type_check;
ALTER TABLE public.picks
  ADD CONSTRAINT picks_pick_type_check
  CHECK (pick_type IN ('winner', 'over_under', 'spread'));

-- 3. picks: add spread columns
ALTER TABLE public.picks
  ADD COLUMN IF NOT EXISTS spread_choice text CHECK (spread_choice IN ('home', 'away')),
  ADD COLUMN IF NOT EXISTS spread_line   numeric(4,1);

-- 4. competitions: add spread toggle
ALTER TABLE public.competitions
  ADD COLUMN IF NOT EXISTS enable_spread boolean NOT NULL DEFAULT false;
