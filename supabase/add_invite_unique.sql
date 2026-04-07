-- Run in Supabase SQL editor.
-- Adds a unique constraint so we can upsert invites without duplicates.
alter table public.invites
  add constraint if not exists invites_competition_email_unique
  unique (competition_id, invited_email);
