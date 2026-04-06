-- Home Field Advantage — database schema
-- Run this in the Supabase SQL editor for your project.

-- ============== profiles ==============
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  created_at timestamptz default now()
);

-- Auto-create a profile row when a new auth user appears.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'name', new.email))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============== competitions ==============
-- A competition is a 1v1 NHL pick'em between exactly two profiles.
create table if not exists public.competitions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sport text not null default 'NHL',
  -- 'daily' | 'weekly' | 'season'
  duration text not null check (duration in ('daily','weekly','season')),
  -- Inclusive date range (UTC dates of the NHL slate).
  start_date date not null,
  end_date date not null,
  creator_id uuid not null references public.profiles(id) on delete cascade,
  opponent_id uuid references public.profiles(id) on delete set null,
  -- Token used for shareable invite links.
  invite_token text unique not null default encode(gen_random_bytes(16),'hex'),
  status text not null default 'pending'
    check (status in ('pending','active','complete','cancelled')),
  created_at timestamptz default now()
);

create index if not exists competitions_creator_idx on public.competitions(creator_id);
create index if not exists competitions_opponent_idx on public.competitions(opponent_id);

-- ============== picks ==============
-- One row per pick made in a competition. game_id is the NHL gamePk (integer
-- from the public NHL API). We store team info denormalized so we don't have
-- to re-fetch the schedule to render history.
create table if not exists public.picks (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions(id) on delete cascade,
  game_date date not null,
  game_id bigint not null,
  picker_id uuid not null references public.profiles(id) on delete cascade,
  picked_team_abbrev text not null,
  picked_team_name text not null,
  -- Filled in after the game finishes so we can score.
  result text check (result in ('win','loss','push','pending')) default 'pending',
  pick_index int not null, -- 0-based position within that day's draft order
  created_at timestamptz default now(),
  unique(competition_id, game_id),
  unique(competition_id, game_date, pick_index)
);

create index if not exists picks_competition_idx on public.picks(competition_id);
create index if not exists picks_date_idx on public.picks(competition_id, game_date);

-- ============== email invites ==============
create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions(id) on delete cascade,
  invited_email text not null,
  invited_by uuid not null references public.profiles(id) on delete cascade,
  accepted boolean default false,
  created_at timestamptz default now()
);

-- ============== Row Level Security ==============
alter table public.profiles enable row level security;
alter table public.competitions enable row level security;
alter table public.picks enable row level security;
alter table public.invites enable row level security;

-- profiles: anyone signed-in can read (so opponents can see names); user can update self
create policy "profiles readable" on public.profiles
  for select using (auth.role() = 'authenticated');
create policy "profiles self update" on public.profiles
  for update using (auth.uid() = id);

-- competitions: visible to creator + opponent
create policy "competitions visible to participants" on public.competitions
  for select using (auth.uid() = creator_id or auth.uid() = opponent_id);
create policy "competitions insert by creator" on public.competitions
  for insert with check (auth.uid() = creator_id);
create policy "competitions update by participants" on public.competitions
  for update using (auth.uid() = creator_id or auth.uid() = opponent_id);

-- picks: visible to participants of the competition; insert only by the picker
create policy "picks visible to participants" on public.picks
  for select using (
    exists (select 1 from public.competitions c
            where c.id = competition_id
              and (auth.uid() = c.creator_id or auth.uid() = c.opponent_id))
  );
create policy "picks insert by self" on public.picks
  for insert with check (
    auth.uid() = picker_id
    and exists (select 1 from public.competitions c
                where c.id = competition_id
                  and (auth.uid() = c.creator_id or auth.uid() = c.opponent_id))
  );

-- invites: visible to inviter + invitee (matched by email after they sign up)
create policy "invites visible to inviter" on public.invites
  for select using (auth.uid() = invited_by);
create policy "invites insert by inviter" on public.invites
  for insert with check (auth.uid() = invited_by);
