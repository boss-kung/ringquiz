-- =============================================================================
-- Migration: 20260501000002_helpers.sql
-- Helper RPC functions called by Edge Functions.
-- =============================================================================

-- increment_player_score
-- Called by submit-answer after a successful answer insert.
-- Uses UPDATE with arithmetic to avoid a race condition that would occur
-- if we fetched total_score first and then set it.
-- Non-critical: players.total_score is a convenience field.
-- Authoritative scores come from the answers table via compute_leaderboard.
CREATE OR REPLACE FUNCTION increment_player_score(
  p_player_id UUID,
  p_amount    INT
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  UPDATE players
     SET total_score = total_score + p_amount
   WHERE id = p_player_id;
END;
$$;

-- increment_game_session_version
-- Called by hard_reset_game to increment session_version.
-- Safe to call even if session_version column doesn't exist yet (will be no-op).
CREATE OR REPLACE FUNCTION increment_game_session_version()
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  BEGIN
    UPDATE game_state
       SET session_version = session_version + 1
     WHERE id = '00000000-0000-0000-0000-000000000001';
  EXCEPTION WHEN OTHERS THEN
    -- Column might not exist yet; this is non-critical
    NULL;
  END;
END;
$$;
