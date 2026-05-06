-- Improve hot-path answer stats queries used by display and host dashboards.

CREATE INDEX IF NOT EXISTS idx_answers_question_correct
  ON answers(question_id)
  WHERE is_correct = TRUE;
