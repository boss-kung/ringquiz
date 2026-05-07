-- Enforce one bank question per game set.
-- This replaces the earlier duplicate-version migrations that could not be
-- pushed reliably because they shared the same timestamp prefix.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.game_set_questions
    GROUP BY game_set_id, question_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot add unique game_set/question constraint: duplicate question_id values already exist within a game set.';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'gsq_unique_question_per_set'
      AND conrelid = 'public.game_set_questions'::regclass
  ) THEN
    ALTER TABLE public.game_set_questions
      ADD CONSTRAINT gsq_unique_question_per_set
      UNIQUE (game_set_id, question_id);
  END IF;
END $$;
