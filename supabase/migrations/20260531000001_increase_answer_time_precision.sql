-- Store answer timing with enough precision for detailed CSV exports.
-- Existing rows keep only the precision they already had; new answers will retain
-- up to 8 decimal places of time_remaining_ratio.

ALTER TABLE public.answers
  ALTER COLUMN time_remaining_ratio TYPE NUMERIC(10,8)
  USING time_remaining_ratio::NUMERIC(10,8);

COMMENT ON COLUMN public.answers.time_remaining_ratio IS
  'Server-computed fraction of question time remaining when the answer was submitted.';
