-- Restrict authenticated players to updating only their display_name.
-- Service-role edge functions remain unaffected.

REVOKE UPDATE ON public.players FROM authenticated;
GRANT UPDATE (display_name) ON public.players TO authenticated;
