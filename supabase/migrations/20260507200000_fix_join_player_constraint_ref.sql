-- Fix persistent "column reference id is ambiguous" in join_player().
--
-- Root cause: RETURNS TABLE (id uuid, display_name text) creates implicit
-- PL/pgSQL OUT variables named `id` and `display_name`. Any unqualified
-- reference to `id` inside the function body — including ON CONFLICT (id)
-- and RETURNING aliases — is ambiguous between the table column and the
-- OUT variable.
--
-- Fix:
--   1. ON CONFLICT ON CONSTRAINT players_pkey  — avoids column-name reference entirely.
--   2. RETURNING p.id, p.display_name INTO v_id, v_name  — stores into declared
--      variables (not OUT variables), eliminating the ambiguity.
--   3. RETURN QUERY SELECT v_id, v_name  — positions map to the RETURNS TABLE
--      columns (id, display_name) without any name clash.

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
  v_uid          uuid := auth.uid();
  v_display_name text := btrim(display_name_input);
  v_id           uuid;
  v_name         text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF v_display_name IS NULL OR char_length(v_display_name) < 1 OR char_length(v_display_name) > 30 THEN
    RAISE EXCEPTION 'invalid_display_name';
  END IF;

  INSERT INTO public.players AS p (id, display_name)
  VALUES (v_uid, v_display_name)
  ON CONFLICT ON CONSTRAINT players_pkey DO UPDATE
    SET display_name = EXCLUDED.display_name
  RETURNING p.id, p.display_name
  INTO v_id, v_name;

  RETURN QUERY SELECT v_id, v_name;
END;
$$;
