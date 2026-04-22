-- Migration: feedback table for support requests and game suggestions
-- Run in Supabase SQL editor.

create table if not exists public.feedback (
  id         uuid primary key default gen_random_uuid(),
  type       text not null check (type in ('support', 'suggestion')),
  name       text,
  email      text,
  message    text not null,
  user_id    uuid references public.profiles(id) on delete set null,
  created_at timestamptz default now()
);

-- No RLS needed — inserts go through the server-side API route
-- using the admin client, so the table doesn't need user-level policies.
-- Read access is intentionally restricted to the service role only.
alter table public.feedback enable row level security;
