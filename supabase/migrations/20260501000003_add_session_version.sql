-- =============================================================================
-- Migration: 20260501000003_add_session_version.sql
-- Add session_version column to game_state for hard reset detection
-- =============================================================================

DO $$ BEGIN
  ALTER TABLE game_state
    ADD COLUMN session_version INT NOT NULL DEFAULT 1;
EXCEPTION WHEN duplicate_column THEN
  NULL;  -- Column already exists, skip
END $$;

-- Ensure existing row has session_version = 1
UPDATE game_state SET session_version = 1 WHERE session_version IS NULL;

-- =============================================================================
-- VERIFICATION
-- =============================================================================
-- SELECT session_version FROM game_state;  -- expect: 1 for existing row
