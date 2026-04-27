-- Migration: pool competition support
-- Run in Supabase SQL editor.

-- ── 1. Add format + max_members to competitions ───────────────────────────
alter table public.competitions
  add column if not exists format text not null default '1v1'
    check (format in ('1v1', 'pool')),
  add column if not exists max_members integer; -- null = unlimited for pools

-- ── 2. competition_members table ──────────────────────────────────────────
-- Tracks every participant in a pool competition.
-- 1v1 competitions don't use this table (creator/opponent stay on competitions).
create table if not exists public.competition_members (
  id             uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions(id) on delete cascade,
  user_id        uuid not null references public.profiles(id) on delete cascade,
  joined_at      timestamptz default now(),
  unique (competition_id, user_id)
);

alter table public.competition_members enable row level security;

-- Members can see all other members of competitions they belong to.
create policy "members visible to pool participants" on public.competition_members
  for select using (
    exists (
      select 1 from public.competition_members cm
      where cm.competition_id = competition_members.competition_id
        and cm.user_id = auth.uid()
    )
  );

-- Users can insert their own membership (joining a pool).
create policy "users can join pools" on public.competition_members
  for insert with check (auth.uid() = user_id);

-- Creator can remove members (kick).
create policy "creator can remove members" on public.competition_members
  for delete using (
    exists (
      select 1 from public.competitions c
      where c.id = competition_members.competition_id
        and c.creator_id = auth.uid()
    )
  );

-- ── 3. Creator is auto-member of their own pool ───────────────────────────
-- When a pool competition is created, insert the creator as the first member.
-- This is handled in the app layer (createCompetition), not a trigger,
-- so no DB function needed here.

-- ── 4. Index for fast leaderboard queries ─────────────────────────────────
create index if not exists competition_members_comp_idx
  on public.competition_members (competition_id);
