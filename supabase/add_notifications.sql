-- Run in Supabase SQL editor.
-- Tracks which notification emails have been sent per competition per day
-- so the cron never sends duplicates.

create table if not exists public.competition_notifications (
  competition_id    uuid not null references public.competitions(id) on delete cascade,
  notification_date date not null,
  notification_type text not null, -- 'picks_open'
  sent_at           timestamptz default now(),
  primary key (competition_id, notification_date, notification_type)
);

alter table public.competition_notifications enable row level security;

-- Only the service role (cron) can write; participants can read.
create policy "notifications readable by participants" on public.competition_notifications
  for select using (
    exists (
      select 1 from public.competitions c
      where c.id = competition_id
        and (auth.uid() = c.creator_id or auth.uid() = c.opponent_id)
    )
  );
