-- display_events: lightweight host-triggered visual events for the Big Screen.
-- Inserted only via host-action edge function (service role). Display clients
-- subscribe via Realtime and poll as fallback. Events older than 10 seconds
-- are ignored by the Display client to avoid stale hype on page reload.

create table public.display_events (
  id         uuid        primary key default gen_random_uuid(),
  event_type text        not null,
  payload    jsonb       not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by text        null
);

alter table public.display_events enable row level security;

-- Display (anon) and authenticated clients may read events.
-- Inserts must go through host-action (service role bypasses RLS).
create policy "display_events_read" on public.display_events
  for select
  to anon, authenticated
  using (true);

-- Add to the existing realtime publication so Display can subscribe.
alter publication supabase_realtime add table public.display_events;
