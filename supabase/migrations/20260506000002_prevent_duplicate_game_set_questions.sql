-- Prevent the same bank question from appearing multiple times in one game set.
-- This keeps game_set_questions aligned with answers, which are unique on
-- (player_id, question_id).

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM game_set_questions
    GROUP BY game_set_id, question_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot add unique game_set/question constraint: duplicate question_id values already exist within a game set.';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_gsq_unique_question_per_set
  ON game_set_questions(game_set_id, question_id);
