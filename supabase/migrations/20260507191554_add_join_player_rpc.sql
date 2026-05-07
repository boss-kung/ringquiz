-- Join or refresh the current player's row via a SECURITY DEFINER RPC.
-- This avoids client-side INSERT/UPSERT privilege and RLS edge cases while
-- still constraining writes to auth.uid().

CREATE OR REPLACE FUNCTION public.join_player(display_name_input text)
RETURNS TABLE (
  id uuid,
  display_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_display_name text := btrim(display_name_input);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF v_display_name IS NULL OR char_length(v_display_name) < 1 OR char_length(v_display_name) > 30 THEN
    RAISE EXCEPTION 'invalid_display_name';
  END IF;

  INSERT INTO public.players AS p (id, display_name)
  VALUES (v_uid, v_display_name)
  ON CONFLICT (id) DO UPDATE
    SET display_name = EXCLUDED.display_name
  RETURNING p.id, p.display_name
  INTO id, display_name;

  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.join_player(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.join_player(text) TO authenticated;
