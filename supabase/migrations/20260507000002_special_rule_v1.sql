-- Special Rule V1
-- Evolves older special_round_* fields into a richer special_rule_* model.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'game_set_questions'
      AND column_name = 'special_round_type'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'game_set_questions'
      AND column_name = 'special_rule_type'
  ) THEN
    ALTER TABLE public.game_set_questions
      RENAME COLUMN special_round_type TO special_rule_type;
  END IF;
END $$;

ALTER TABLE public.game_set_questions
  ADD COLUMN IF NOT EXISTS special_rule_type text NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS special_rule_config jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'game_set_questions_special_round_type_check'
  ) THEN
    ALTER TABLE public.game_set_questions
      DROP CONSTRAINT game_set_questions_special_round_type_check;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'game_set_questions_special_rule_type_check'
  ) THEN
    ALTER TABLE public.game_set_questions
      DROP CONSTRAINT game_set_questions_special_rule_type_check;
  END IF;
END $$;

ALTER TABLE public.game_set_questions
  ADD CONSTRAINT game_set_questions_special_rule_type_check
  CHECK (special_rule_type IN (
    'normal',
    'double_score',
    'triple_score',
    'speed_bonus',
    'no_mistake',
    'fastest_finger',
    'mystery_multiplier'
  ));

UPDATE public.game_set_questions
SET
  special_rule_type = CASE special_rule_type
    WHEN 'mystery_round' THEN 'mystery_multiplier'
    ELSE special_rule_type
  END,
  special_rule_config = CASE
    WHEN special_rule_type = 'double_score' THEN jsonb_build_object('multiplier', 2)
    WHEN special_rule_type = 'speed_bonus' THEN jsonb_build_object('bonus_ratio', 0.5, 'max_bonus_points', 500)
    WHEN special_rule_type = 'mystery_round' THEN jsonb_build_object('multiplier', 2, 'hidden_until_reveal', true)
    WHEN special_rule_type = 'mystery_multiplier' THEN jsonb_build_object('multiplier', 2, 'hidden_until_reveal', true)
    ELSE '{}'::jsonb
  END
WHERE special_rule_config = '{}'::jsonb;

ALTER TABLE public.answers
  ADD COLUMN IF NOT EXISTS special_rule_type text NULL,
  ADD COLUMN IF NOT EXISTS special_rule_config_snapshot jsonb NULL,
  ADD COLUMN IF NOT EXISTS score_breakdown jsonb NULL,
  ADD COLUMN IF NOT EXISTS special_bonus_applied boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'score_non_negative'
  ) THEN
    ALTER TABLE public.answers
      DROP CONSTRAINT score_non_negative;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'answers_special_rule_type_check'
  ) THEN
    ALTER TABLE public.answers
      DROP CONSTRAINT answers_special_rule_type_check;
  END IF;
END $$;

ALTER TABLE public.answers
  ADD CONSTRAINT answers_special_rule_type_check
  CHECK (
    special_rule_type IS NULL OR special_rule_type IN (
      'normal',
      'double_score',
      'triple_score',
      'speed_bonus',
      'no_mistake',
      'fastest_finger',
      'mystery_multiplier'
    )
  );

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'total_score_non_negative'
  ) THEN
    ALTER TABLE public.players
      DROP CONSTRAINT total_score_non_negative;
  END IF;
END $$;
