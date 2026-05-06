-- Allow authenticated anonymous players/display clients to read the single
-- current live question even if it is not marked published yet.
--
-- This fixes live gameplay rendering when a game set still references a draft
-- question. The row remains private outside the current game_state pointer.

CREATE POLICY "authenticated_read_current_live_question"
  ON questions FOR SELECT TO authenticated
  USING (
    id = (
      SELECT current_question_id
      FROM game_state
      WHERE id = '00000000-0000-0000-0000-000000000001'
    )
  );
