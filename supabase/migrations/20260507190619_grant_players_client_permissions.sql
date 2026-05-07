-- Ensure authenticated players can create and maintain their own player row.
-- This fixes production environments where table-level INSERT/SELECT privileges
-- on public.players were not granted explicitly, causing "permission denied"
-- before RLS policies were even evaluated.

GRANT SELECT ON public.players TO authenticated;
GRANT INSERT ON public.players TO authenticated;
GRANT UPDATE (display_name) ON public.players TO authenticated;

-- Display and other read-only clients sign in anonymously in practice, but make
-- the read privilege explicit as well so environments do not depend on defaults.
GRANT SELECT ON public.players TO anon;
