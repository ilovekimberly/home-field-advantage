-- Run in Supabase SQL editor.
-- Tracks which competitions have already received a "picks opening tonight"
-- notification for a given date, so the cron never sends twice.

create table if not exists public.pick_notifications (
  competition_id uuid not null references public.competitions(id) on delete cascade,
  game_date      date not null,
  sent_at        timestamptz default now(),
  primary key (competition_id, game_date)
);

alter table public.pick_notifications enable row level security;

-- Only the service role (cron) needs to read/write this table.
-- Participants don't need direct access.
create policy "pick_notifications service only" on public.pick_notifications
  for all using (false);
