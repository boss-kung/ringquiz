-- Fix ambiguous output-column references inside join_player().

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

  RETURN QUERY
  INSERT INTO public.players AS p (id, display_name)
  VALUES (v_uid, v_display_name)
  ON CONFLICT (id) DO UPDATE
    SET display_name = EXCLUDED.display_name
  RETURNING p.id AS id, p.display_name AS display_name;
END;
$$;
