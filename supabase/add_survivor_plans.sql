-- Survivor pick planning.
--
-- A plan is a PRIVATE, non-binding map of which team a user intends to use in
-- each future week. It is deliberately separate from survivor_picks:
--   · survivor_picks = committed picks that score and can eliminate you
--   · survivor_plans = intentions, visible only to their owner
--
-- A plan row can be flagged auto_submit, which lets the lock-time cron turn it
-- into a real pick if the user hasn't picked that week.

create table if not exists public.survivor_plans (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  -- Calendar year the NFL season kicked off in, matching survivor_picks.
  season_year int not null,
  week_number int not null,
  team_abbrev text not null,
  -- When true, the cron submits this as a real pick at lock if none exists.
  auto_submit boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One planned team per user per week.
create unique index if not exists survivor_plans_unique_week
  on public.survivor_plans(competition_id, user_id, week_number);

create index if not exists survivor_plans_user_idx
  on public.survivor_plans(competition_id, user_id);

-- Reads and writes go through server-side routes using the admin client, which
-- scope every query to the requesting user. RLS stays on with no permissive
-- policies so plans can never leak between members.
alter table public.survivor_plans enable row level security;
