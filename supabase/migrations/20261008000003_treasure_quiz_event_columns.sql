-- Persist the Player's event choice and its draw result at round checkpoints.
alter table public.tq_rounds
  add column if not exists event_choice text
    check (event_choice is null or event_choice in ('skip', 'gold', 'diamond')),
  add column if not exists event_result jsonb;
