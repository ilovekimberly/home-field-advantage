-- Run this in the Supabase SQL editor to fix the invite-link join flow.
-- It allows any signed-in user to look up a competition that is still
-- pending (i.e. waiting for an opponent), so the join route can find it
-- before they've been added as the opponent_id.

create policy "competitions joinable when pending" on public.competitions
  for select using (
    auth.role() = 'authenticated' and status = 'pending'
  );
