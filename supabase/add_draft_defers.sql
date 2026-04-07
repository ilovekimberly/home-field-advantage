-- Run in Supabase SQL editor.
-- Stores the per-date defer choice for each competition.
-- The better-record player can choose to take picks #2 and #3 instead of #1.

create table if not exists public.draft_defers (
  competition_id uuid not null references public.competitions(id) on delete cascade,
  game_date      date not null,
  deferred       boolean not null default false,
  chosen_by      uuid not null references public.profiles(id),
  created_at     timestamptz default now(),
  primary key (competition_id, game_date)
);

alter table public.draft_defers enable row level security;

-- Participants of a competition can read and write its defer choices.
create policy "draft_defers visible to participants" on public.draft_defers
  for select using (
    exists (
      select 1 from public.competitions c
      where c.id = competition_id
        and (auth.uid() = c.creator_id or auth.uid() = c.opponent_id)
    )
  );

create policy "draft_defers insert by participants" on public.draft_defers
  for insert with check (
    auth.uid() = chosen_by
    and exists (
      select 1 from public.competitions c
      where c.id = competition_id
        and (auth.uid() = c.creator_id or auth.uid() = c.opponent_id)
    )
  );
