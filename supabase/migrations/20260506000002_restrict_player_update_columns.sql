-- =============================================================================
-- Migration: 20260506000002_restrict_player_update_columns.sql
-- Restrict the authenticated role to updating only display_name on players.
--
-- Problem: the existing "authenticated_update_own_player" RLS policy gates
-- which ROW can be updated (own row only) but does not restrict which COLUMNS.
-- A player can call supabase.from('players').update({ total_score: 99999 })
-- directly from the browser and bypass server-side scoring.
--
-- Fix: revoke the blanket UPDATE privilege from authenticated, then re-grant
-- it only for the display_name column. Column-level privileges are checked
-- before RLS policies, so this closes the gap completely.
--
-- Edge Functions use the service role, which bypasses both RLS and column
-- privileges — no change needed there.
-- =============================================================================

-- Remove blanket UPDATE privilege on players for the authenticated role.
-- (Supabase grants this by default during table creation.)
REVOKE UPDATE ON public.players FROM authenticated;

-- Re-grant UPDATE restricted to the display_name column only.
GRANT UPDATE (display_name) ON public.players TO authenticated;

-- =============================================================================
-- VERIFICATION (run manually after migration)
-- =============================================================================
-- From a browser with a valid anon JWT, attempt:
--   supabase.from('players').update({ total_score: 9999 }).eq('id', myId)
-- Expected: PostgreSQL error "permission denied for column total_score"
--
-- Also verify display_name updates still work:
--   supabase.from('players').update({ display_name: 'NewName' }).eq('id', myId)
-- Expected: success (if own row)
