-- Corrective Round Mode migration.
-- Adds special_round_type and special_round_label to game_set_questions for
-- environments where the original migration was not applied.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'game_set_questions'
      AND column_name = 'special_round_type'
  ) THEN
    ALTER TABLE public.game_set_questions
      ADD COLUMN special_round_type text NOT NULL DEFAULT 'normal';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'game_set_questions'
      AND column_name = 'special_round_label'
  ) THEN
    ALTER TABLE public.game_set_questions
      ADD COLUMN special_round_label text NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'game_set_questions_special_round_type_check'
  ) THEN
    ALTER TABLE public.game_set_questions
      ADD CONSTRAINT game_set_questions_special_round_type_check
      CHECK (special_round_type IN ('normal', 'double_score', 'speed_bonus', 'mystery_round'));
  END IF;
END $$;
