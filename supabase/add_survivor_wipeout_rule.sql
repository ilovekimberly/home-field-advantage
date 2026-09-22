-- What happens when every remaining survivor is eliminated in the same week.
--
-- The existing `tiebreaker` column covers the opposite case (several survivors
-- still standing at the end). This covers the wipeout: without a rule the pool
-- just closed with nobody winning.
--
--   co_winners — everyone knocked out in the final week shares the win
--   revive     — undo that week's eliminations and replay the next week
--   no_winner  — the pool simply ends with no winner (the old behaviour)

alter table public.competitions
  add column if not exists wipeout_rule text
    check (wipeout_rule in ('co_winners', 'revive', 'no_winner'))
    default 'co_winners';
