-- =============================================================================
-- Migration: 20260504000001_game_sets.sql
-- Separate Question Bank from Game Set (playable playlist).
--
-- Design:
--   questions            → permanent question bank (content + default settings)
--   game_sets            → named playable playlists
--   game_set_questions   → selected questions per game set with snapshot values
--
-- Runtime: scoring and navigation use game_set_questions snapshot values only.
-- Question Bank defaults are copied into game_set_questions when a question is
-- added to a game set. They do NOT auto-sync after that point.
-- =============================================================================


-- =============================================================================
-- TABLE: game_sets
-- =============================================================================

CREATE TABLE game_sets (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL,
  status      TEXT        NOT NULL DEFAULT 'draft'
              CHECK (status IN ('draft', 'active', 'archived')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_game_sets_status ON game_sets(status);

CREATE TRIGGER trg_game_sets_updated_at
  BEFORE UPDATE ON game_sets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- =============================================================================
-- TABLE: game_set_questions
-- Snapshot values: copied from question bank at add time. Independent after.
-- =============================================================================

CREATE TABLE game_set_questions (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  game_set_id         UUID        NOT NULL REFERENCES game_sets(id)  ON DELETE CASCADE,
  question_id         UUID        NOT NULL REFERENCES questions(id),
  play_order          INT         NOT NULL,
  time_limit_seconds  INT         NOT NULL DEFAULT 30,
  max_score           INT         NOT NULL DEFAULT 1000,
  min_correct_score   INT         NOT NULL DEFAULT 100,
  circle_radius_ratio NUMERIC(5,4) NOT NULL DEFAULT 0.10,
  is_enabled          BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT gsq_play_order_unique    UNIQUE (game_set_id, play_order),
  CONSTRAINT gsq_time_limit_positive  CHECK  (time_limit_seconds > 0),
  CONSTRAINT gsq_max_score_valid      CHECK  (max_score >= 0),
  CONSTRAINT gsq_min_score_valid      CHECK  (min_correct_score >= 0 AND min_correct_score <= max_score),
  CONSTRAINT gsq_circle_radius_range  CHECK  (circle_radius_ratio > 0 AND circle_radius_ratio <= 0.5)
);

CREATE INDEX idx_gsq_game_set_play_order ON game_set_questions(game_set_id, play_order);
CREATE INDEX idx_gsq_question_id         ON game_set_questions(question_id);

CREATE TRIGGER trg_game_set_questions_updated_at
  BEFORE UPDATE ON game_set_questions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- =============================================================================
-- game_state: add active_game_set_id and current_game_set_question_id
-- =============================================================================

ALTER TABLE game_state
  ADD COLUMN active_game_set_id          UUID REFERENCES game_sets(id),
  ADD COLUMN current_game_set_question_id UUID REFERENCES game_set_questions(id);


-- =============================================================================
-- ROW LEVEL SECURITY
-- game_sets and game_set_questions are public-read.
-- Mutations are via Edge Functions (service role bypasses RLS).
-- =============================================================================

ALTER TABLE game_sets          ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_set_questions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_read_game_sets"
  ON game_sets FOR SELECT
  USING (true);

CREATE POLICY "public_read_game_set_questions"
  ON game_set_questions FOR SELECT
  USING (true);


-- =============================================================================
-- FUNCTION: compute_leaderboard (updated)
-- Adds optional p_game_set_question_id parameter.
-- When provided, uses game set play_order for cumulative score calculation.
-- When NULL (default), falls back to legacy order_index behaviour.
-- Existing call sites compute_leaderboard(question_id) still work unchanged.
-- =============================================================================

CREATE OR REPLACE FUNCTION compute_leaderboard(
  p_question_id          UUID,
  p_game_set_question_id UUID DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_order_index     INT;
  v_play_order      INT;
  v_game_set_id     UUID;
  v_entries_written INT;
BEGIN
  -- Idempotent: remove any existing snapshot for this question before recomputing
  DELETE FROM leaderboard_snapshot WHERE question_id = p_question_id;

  IF p_game_set_question_id IS NOT NULL THEN
    -- ── Game-set-aware mode ────────────────────────────────────────────────
    -- Cumulative score = sum of answers for bank questions whose game-set row
    -- has play_order <= current play_order, within the same game set.
    SELECT gsq.play_order, gsq.game_set_id
      INTO v_play_order, v_game_set_id
      FROM game_set_questions gsq
     WHERE gsq.id = p_game_set_question_id;

    IF v_play_order IS NULL THEN
      RAISE EXCEPTION 'compute_leaderboard: game_set_question not found: %', p_game_set_question_id;
    END IF;

    INSERT INTO leaderboard_snapshot
      (question_id, player_id, rank, display_name, question_score, cumulative_score)
    SELECT
      p_question_id,
      p.id,
      ROW_NUMBER() OVER (
        ORDER BY COALESCE(SUM(a.score), 0) DESC,
                 p.joined_at ASC
      )                                                                 AS rank,
      p.display_name,
      COALESCE(
        (SELECT score FROM answers
          WHERE player_id = p.id AND question_id = p_question_id),
        0
      )                                                                 AS question_score,
      COALESCE(SUM(a.score), 0)                                         AS cumulative_score
    FROM players p
    LEFT JOIN answers a
           ON a.player_id   = p.id
          AND a.question_id IN (
                SELECT gsq2.question_id
                  FROM game_set_questions gsq2
                 WHERE gsq2.game_set_id = v_game_set_id
                   AND gsq2.play_order  <= v_play_order
                   AND gsq2.is_enabled  = TRUE
              )
    GROUP BY p.id, p.display_name, p.joined_at;

  ELSE
    -- ── Legacy mode ────────────────────────────────────────────────────────
    -- Cumulative score = sum of answers for questions with order_index <= current.
    SELECT order_index
      INTO v_order_index
      FROM questions
     WHERE id = p_question_id;

    IF v_order_index IS NULL THEN
      RAISE EXCEPTION 'compute_leaderboard: question not found: %', p_question_id;
    END IF;

    INSERT INTO leaderboard_snapshot
      (question_id, player_id, rank, display_name, question_score, cumulative_score)
    SELECT
      p_question_id,
      p.id,
      ROW_NUMBER() OVER (
        ORDER BY COALESCE(SUM(a.score), 0) DESC,
                 p.joined_at ASC
      )                                                                 AS rank,
      p.display_name,
      COALESCE(
        (SELECT score FROM answers
          WHERE player_id = p.id AND question_id = p_question_id),
        0
      )                                                                 AS question_score,
      COALESCE(SUM(a.score), 0)                                         AS cumulative_score
    FROM players p
    LEFT JOIN answers a
           ON a.player_id   = p.id
          AND a.question_id IN (
                SELECT id FROM questions
                 WHERE order_index <= v_order_index
              )
    GROUP BY p.id, p.display_name, p.joined_at;
  END IF;

  GET DIAGNOSTICS v_entries_written = ROW_COUNT;
  RETURN v_entries_written;
END;
$$;


-- =============================================================================
-- SEED MIGRATION
-- Create one "Migrated Default Game Set" from all currently published questions,
-- ordered by their existing order_index. Copy current values as snapshot values.
-- Set this game set as active in game_state.
-- =============================================================================

DO $$
DECLARE
  v_game_set_id  UUID    := gen_random_uuid();
  v_play_order   INT     := 1;
  v_question     RECORD;
  v_has_questions BOOLEAN;
BEGIN
  -- Check if there are any published questions
  SELECT EXISTS (
    SELECT 1 FROM questions WHERE is_published = TRUE LIMIT 1
  ) INTO v_has_questions;

  -- Create the game set regardless (may be empty if no published questions)
  INSERT INTO game_sets (id, name, status)
  VALUES (v_game_set_id, 'Migrated Default Game Set', 'active');

  IF v_has_questions THEN
    FOR v_question IN
      SELECT id, time_limit_seconds, max_score, min_correct_score, circle_radius_ratio
        FROM questions
       WHERE is_published = TRUE
       ORDER BY order_index ASC
    LOOP
      INSERT INTO game_set_questions (
        game_set_id, question_id, play_order,
        time_limit_seconds, max_score, min_correct_score, circle_radius_ratio,
        is_enabled
      ) VALUES (
        v_game_set_id, v_question.id, v_play_order,
        v_question.time_limit_seconds,
        v_question.max_score,
        v_question.min_correct_score,
        v_question.circle_radius_ratio,
        TRUE
      );
      v_play_order := v_play_order + 1;
    END LOOP;
  END IF;

  -- Set as active game set in the single game_state row
  UPDATE game_state
     SET active_game_set_id = v_game_set_id
   WHERE id = '00000000-0000-0000-0000-000000000001';

END;
$$;


-- =============================================================================
-- VERIFICATION (run manually after migration)
-- =============================================================================
-- SELECT COUNT(*) FROM game_sets;                          -- expect: 1
-- SELECT status FROM game_sets;                            -- expect: active
-- SELECT COUNT(*) FROM game_set_questions;                 -- expect: N (published qs)
-- SELECT active_game_set_id FROM game_state
--   WHERE id = '00000000-0000-0000-0000-000000000001';     -- expect: non-null UUID
-- SELECT current_game_set_question_id FROM game_state
--   WHERE id = '00000000-0000-0000-0000-000000000001';     -- expect: NULL (pre-game)
