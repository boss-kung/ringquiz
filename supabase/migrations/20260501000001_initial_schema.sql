-- =============================================================================
-- Migration: 20260501000001_initial_schema.sql
-- Realtime multiplayer quiz game — initial schema
-- Single-room, V1. All writes from clients are read-only or own-row only.
-- Privileged writes (game state, answers, leaderboard) go through Edge Functions
-- using the service role key, which bypasses RLS.
-- =============================================================================


-- =============================================================================
-- ENUM
-- =============================================================================

CREATE TYPE game_status AS ENUM (
  'waiting',
  'countdown',
  'question_open',
  'question_closed',
  'reveal',
  'leaderboard',
  'ended'
);


-- =============================================================================
-- TABLE: game_state
-- Single row. id is a fixed seed UUID. Only host-action Edge Function mutates.
-- =============================================================================

CREATE TABLE game_state (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status                 game_status NOT NULL DEFAULT 'waiting',
  current_question_id    UUID,                   -- FK added below after questions
  current_question_index INT,                    -- mirrors order_index of current question
  question_started_at    TIMESTAMPTZ,            -- set by open_question action
  question_ends_at       TIMESTAMPTZ,            -- authoritative server deadline
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- =============================================================================
-- TABLE: questions
-- Pre-loaded before the event. Written by host via SQL in V1, upload UI in V3.
-- =============================================================================

CREATE TABLE questions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_index         INT NOT NULL,
  text                TEXT NOT NULL,
  image_url           TEXT NOT NULL,             -- path in question-images bucket (public)
  circle_radius_ratio NUMERIC(5,4) NOT NULL DEFAULT 0.10,
  time_limit_seconds  INT NOT NULL DEFAULT 30,
  max_score           INT NOT NULL DEFAULT 1000,
  min_correct_score   INT NOT NULL DEFAULT 100,
  image_width         INT,                       -- pixel width; populated by upload (Round 3)
  image_height        INT,                       -- pixel height; populated by upload (Round 3)
  reveal_image_url    TEXT,                      -- optional host-prepared overlay (public, NOT the mask)
  is_published        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT questions_order_unique    UNIQUE (order_index),
  CONSTRAINT circle_radius_range       CHECK (circle_radius_ratio > 0 AND circle_radius_ratio <= 0.5),
  CONSTRAINT time_limit_positive       CHECK (time_limit_seconds > 0),
  CONSTRAINT max_score_positive        CHECK (max_score > 0),
  CONSTRAINT min_score_valid           CHECK (min_correct_score >= 0 AND min_correct_score <= max_score)
);


-- =============================================================================
-- TABLE: question_masks
-- Private. Zero rows returned to any client role.
-- Only Edge Functions (service role) can read mask_storage_path or mask dimensions.
-- mask_width / mask_height should equal image_width / image_height on questions.
-- Populated during question setup / upload.
-- =============================================================================

CREATE TABLE question_masks (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id       UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  mask_storage_path TEXT NOT NULL,               -- path in question-masks bucket (private)
  mask_width        INT,                         -- pixel width of mask PNG
  mask_height       INT,                         -- pixel height of mask PNG
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT question_masks_question_unique UNIQUE (question_id)
);


-- =============================================================================
-- TABLE: players
-- One row per anonymous auth session. id = auth.uid().
-- total_score is a running convenience total incremented by submit-answer.
-- Authoritative leaderboard scores are computed from the answers table.
-- =============================================================================

CREATE TABLE players (
  id            UUID PRIMARY KEY,                -- = auth.uid(), set by client on insert
  display_name  TEXT NOT NULL,
  total_score   INT NOT NULL DEFAULT 0,          -- reset to 0 by reset_game
  joined_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT display_name_length       CHECK (char_length(display_name) BETWEEN 1 AND 30),
  CONSTRAINT total_score_non_negative  CHECK (total_score >= 0)
);


-- =============================================================================
-- TABLE: answers
-- One row per player per question. No client inserts (service role only).
-- UNIQUE constraint is the final duplicate guard — DB-level, not application-level.
-- =============================================================================

CREATE TABLE answers (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id            UUID NOT NULL REFERENCES players(id),
  question_id          UUID NOT NULL REFERENCES questions(id),
  selected_x_ratio     NUMERIC(8,6) NOT NULL,    -- normalized [0,1], client-provided position
  selected_y_ratio     NUMERIC(8,6) NOT NULL,    -- normalized [0,1], client-provided position
  submitted_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  time_remaining_ratio NUMERIC(5,4) NOT NULL,    -- computed server-side from question_ends_at
  is_correct           BOOLEAN NOT NULL DEFAULT FALSE,
  score                INT NOT NULL DEFAULT 0,

  CONSTRAINT answers_player_question_unique UNIQUE (player_id, question_id),
  CONSTRAINT x_ratio_range     CHECK (selected_x_ratio >= 0 AND selected_x_ratio <= 1),
  CONSTRAINT y_ratio_range     CHECK (selected_y_ratio >= 0 AND selected_y_ratio <= 1),
  CONSTRAINT time_ratio_range  CHECK (time_remaining_ratio >= 0 AND time_remaining_ratio <= 1),
  CONSTRAINT score_non_negative CHECK (score >= 0)
);


-- =============================================================================
-- TABLE: leaderboard_snapshot
-- Written by compute_leaderboard() after each question closes.
-- Service role write only. All clients may read.
-- Idempotent: DELETE + INSERT on each recompute.
-- =============================================================================

CREATE TABLE leaderboard_snapshot (
  question_id      UUID NOT NULL REFERENCES questions(id),
  player_id        UUID NOT NULL REFERENCES players(id),
  rank             INT NOT NULL,
  display_name     TEXT NOT NULL,                -- denormalized for fast reads without join
  question_score   INT NOT NULL DEFAULT 0,       -- score on this question only (0 if missed)
  cumulative_score INT NOT NULL DEFAULT 0,       -- sum of all answers up to this question

  PRIMARY KEY (question_id, player_id)
);


-- =============================================================================
-- FOREIGN KEY: game_state → questions
-- Added after both tables exist.
-- =============================================================================

ALTER TABLE game_state
  ADD CONSTRAINT fk_game_state_current_question
  FOREIGN KEY (current_question_id) REFERENCES questions(id);


-- =============================================================================
-- INDEXES
-- =============================================================================

CREATE INDEX idx_answers_question_id
  ON answers(question_id);

CREATE INDEX idx_answers_player_id
  ON answers(player_id);

CREATE INDEX idx_leaderboard_question_rank
  ON leaderboard_snapshot(question_id, rank);

CREATE INDEX idx_questions_order_index
  ON questions(order_index);

-- Partial index for published-only lookups (used by next_question logic)
CREATE INDEX idx_questions_published_order
  ON questions(order_index)
  WHERE is_published = TRUE;


-- =============================================================================
-- TRIGGERS
-- =============================================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_game_state_updated_at
  BEFORE UPDATE ON game_state
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_question_masks_updated_at
  BEFORE UPDATE ON question_masks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- =============================================================================
-- FUNCTION: compute_leaderboard
-- Idempotent snapshot computation. Safe to call multiple times with same input.
-- Called by host-action Edge Function on close_question and recompute_leaderboard.
-- Returns number of rows written.
--
-- Scoring source of truth: answers.score (NOT players.total_score)
-- players.total_score is a convenience running total, not used here.
-- =============================================================================

CREATE OR REPLACE FUNCTION compute_leaderboard(p_question_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_order_index     INT;
  v_entries_written INT;
BEGIN
  -- Resolve order_index for the closing question
  SELECT order_index
    INTO v_order_index
    FROM questions
   WHERE id = p_question_id;

  IF v_order_index IS NULL THEN
    RAISE EXCEPTION 'compute_leaderboard: question not found: %', p_question_id;
  END IF;

  -- Idempotent: remove any existing snapshot for this question before recomputing
  DELETE FROM leaderboard_snapshot
   WHERE question_id = p_question_id;

  -- Insert fresh snapshot
  -- cumulative_score = sum of all correct+incorrect scores for questions up to this one
  -- question_score   = score on this specific question (0 if not answered or incorrect)
  -- tiebreaker       = earlier joined_at wins on equal cumulative score
  INSERT INTO leaderboard_snapshot
    (question_id, player_id, rank, display_name, question_score, cumulative_score)
  SELECT
    p_question_id,
    p.id,
    ROW_NUMBER() OVER (
      ORDER BY COALESCE(SUM(a.score), 0) DESC,
               p.joined_at ASC
    )                                                               AS rank,
    p.display_name,
    COALESCE(
      (SELECT score FROM answers
        WHERE player_id = p.id AND question_id = p_question_id),
      0
    )                                                               AS question_score,
    COALESCE(SUM(a.score), 0)                                       AS cumulative_score
  FROM players p
  LEFT JOIN answers a
         ON a.player_id   = p.id
        AND a.question_id IN (
              SELECT id FROM questions
               WHERE order_index <= v_order_index
            )
  GROUP BY p.id, p.display_name, p.joined_at;

  GET DIAGNOSTICS v_entries_written = ROW_COUNT;
  RETURN v_entries_written;
END;
$$;


-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

ALTER TABLE game_state          ENABLE ROW LEVEL SECURITY;
ALTER TABLE questions           ENABLE ROW LEVEL SECURITY;
ALTER TABLE question_masks      ENABLE ROW LEVEL SECURITY;
ALTER TABLE players             ENABLE ROW LEVEL SECURITY;
ALTER TABLE answers             ENABLE ROW LEVEL SECURITY;
ALTER TABLE leaderboard_snapshot ENABLE ROW LEVEL SECURITY;

-- ── game_state ──────────────────────────────────────────────────────────────
-- Read-only for everyone. Mutations only via Edge Function service role.

CREATE POLICY "public_read_game_state"
  ON game_state FOR SELECT
  USING (true);

-- ── questions ────────────────────────────────────────────────────────────────
-- Authenticated users read published questions only.
-- Unauthenticated (anon role) cannot read — players must sign in anonymously first.
-- No client write policies — mutations only via service role.

CREATE POLICY "authenticated_read_published_questions"
  ON questions FOR SELECT TO authenticated
  USING (is_published = TRUE);

-- ── question_masks ───────────────────────────────────────────────────────────
-- TOTAL LOCKOUT. The USING (false) predicate means no row ever matches.
-- This applies to all operations from all client roles.
-- Service role bypasses RLS entirely — only Edge Functions use service role.

CREATE POLICY "deny_all_question_masks"
  ON question_masks FOR ALL
  USING (false);

-- ── players ──────────────────────────────────────────────────────────────────
-- Anyone can read all player display names and total scores (leaderboard use).
-- Authenticated users may insert their own row (id must equal auth.uid()).
-- Authenticated users may update their own display_name only.
-- total_score is updated only by submit-answer Edge Function (service role).

CREATE POLICY "public_read_players"
  ON players FOR SELECT
  USING (true);

CREATE POLICY "authenticated_insert_own_player"
  ON players FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());

CREATE POLICY "authenticated_update_own_player"
  ON players FOR UPDATE TO authenticated
  USING     (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- ── answers ──────────────────────────────────────────────────────────────────
-- Authenticated users may read only their own answer rows.
-- No INSERT policy for any client role — only submit-answer Edge Function inserts.

CREATE POLICY "authenticated_read_own_answers"
  ON answers FOR SELECT TO authenticated
  USING (player_id = auth.uid());

-- ── leaderboard_snapshot ─────────────────────────────────────────────────────
-- Anyone may read. Mutations only via host-action Edge Function (service role).

CREATE POLICY "public_read_leaderboard"
  ON leaderboard_snapshot FOR SELECT
  USING (true);


-- =============================================================================
-- STORAGE RLS
-- Run after creating buckets in the Supabase dashboard.
-- Bucket setup:
--   question-images → Public = true
--   question-masks  → Public = false  (private)
-- =============================================================================

-- Public read for question-images (all players, no auth required)
CREATE POLICY "public_read_question_images"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'question-images');

-- No permissive policy for question-masks is intentional.
-- Private bucket setting blocks public access at the Supabase infrastructure level.
-- The absence of any SELECT policy means RLS default-deny applies as a second layer.
-- Edge Functions use the service role key and bypass storage RLS entirely.


-- =============================================================================
-- SEED
-- Fixed single row for game_state. id never changes.
-- =============================================================================

INSERT INTO game_state (id, status)
VALUES ('00000000-0000-0000-0000-000000000001', 'waiting')
ON CONFLICT (id) DO NOTHING;


-- =============================================================================
-- VERIFICATION (run manually after migration)
-- =============================================================================
-- SELECT COUNT(*) FROM game_state;                -- expect: 1
-- SELECT status FROM game_state;                  -- expect: waiting
-- SELECT current_question_id FROM game_state;     -- expect: NULL
-- SELECT current_question_index FROM game_state;  -- expect: NULL
-- SELECT COUNT(*) FROM answers;                   -- expect: 0
-- SELECT COUNT(*) FROM leaderboard_snapshot;      -- expect: 0
-- SELECT COUNT(*) FROM question_masks;            -- expect: 0 (pre-event)
