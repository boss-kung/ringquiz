-- =============================================================================
-- Migration: 20260506000003_unique_question_per_game_set.sql
-- Add UNIQUE(game_set_id, question_id) to game_set_questions.
--
-- Problem: the table has UNIQUE(game_set_id, play_order) but not on
-- (game_set_id, question_id). The same question can be added twice with
-- different play_order values, causing duplicate scoring (player can earn
-- points for the same question twice) and confusing play_order display.
--
-- Idempotent: skipped if the constraint already exists.
-- Pre-flight: if duplicates already exist this migration will fail.
-- Run the verification query first to confirm no duplicates.
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'gsq_unique_question_per_set'
      AND conrelid = 'public.game_set_questions'::regclass
  ) THEN
    ALTER TABLE public.game_set_questions
      ADD CONSTRAINT gsq_unique_question_per_set
      UNIQUE (game_set_id, question_id);
  END IF;
END $$;

-- =============================================================================
-- VERIFICATION (run before and after migration)
-- =============================================================================
-- Check for existing duplicates (must return 0 rows before running):
-- SELECT game_set_id, question_id, COUNT(*)
--   FROM game_set_questions
--   GROUP BY game_set_id, question_id
--   HAVING COUNT(*) > 1;
--
-- Confirm constraint exists after migration:
-- SELECT conname FROM pg_constraint
--   WHERE conname = 'gsq_unique_question_per_set';
