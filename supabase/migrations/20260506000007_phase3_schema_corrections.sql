-- Corrective Phase 3 migration.
-- Makes display_theme and display_events creation safe when a database has
-- partially applied or replayed schema changes.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'game_state'
      AND column_name = 'display_theme'
  ) THEN
    ALTER TABLE public.game_state
      ADD COLUMN display_theme text NOT NULL DEFAULT 'classic_gold';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'game_state_display_theme_check'
  ) THEN
    ALTER TABLE public.game_state
      ADD CONSTRAINT game_state_display_theme_check
      CHECK (display_theme IN ('classic_gold', 'neon_night', 'danger_round', 'final_round'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.display_events (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text        NOT NULL,
  payload    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text        NULL
);

ALTER TABLE public.display_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'display_events'
      AND policyname = 'display_events_read'
  ) THEN
    CREATE POLICY "display_events_read" ON public.display_events
      FOR SELECT
      TO anon, authenticated
      USING (true);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'display_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.display_events;
  END IF;
END $$;
