-- Add survivor_status column to competition_members.
-- Required for NFL survivor pools — tracks whether a participant is still
-- alive or has been eliminated. NULL for non-survivor (pool) competitions.
alter table public.competition_members
  add column if not exists survivor_status text check (survivor_status in ('alive', 'eliminated'));
