import { useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useGameStore } from '../store/gameStore';

/**
 * On every question_open state, checks if the current player already has an
 * answer row in the DB for this question (e.g. after page refresh).
 * If found: restores circle position and locks the UI — DB row is source of truth.
 *
 * Mounted at the PlayerApp level so it runs even before QuestionScreen mounts.
 * submitted is intentionally excluded from deps: we only need to re-run when
 * the question or player changes, not when local submitted state toggles.
 */
export function useExistingAnswer() {
  const status = useGameStore((s) => s.gameState?.status);
  const questionId = useGameStore((s) => s.gameState?.current_question_id);
  const playerId = useGameStore((s) => s.playerId);
  const setCirclePosition = useGameStore((s) => s.setCirclePosition);
  const setSubmitResult = useGameStore((s) => s.setSubmitResult);

  useEffect(() => {
    if (
      status !== 'question_open' &&
      status !== 'question_closed' &&
      status !== 'reveal' &&
      status !== 'leaderboard' &&
      status !== 'ended'
    ) return;
    if (!questionId || !playerId) return;

    supabase
      .from('answers')
      .select('is_correct, score, selected_x_ratio, selected_y_ratio')
      .eq('player_id', playerId)
      .eq('question_id', questionId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) {
          console.error('[useExistingAnswer] fetch:', error.message);
          return;
        }
        if (!data) return;
        // Restore the circle to where the player originally clicked
        setCirclePosition({
          xRatio: Number(data.selected_x_ratio),
          yRatio: Number(data.selected_y_ratio),
        });
        // Lock the UI — this sets submitted = true in the store
        setSubmitResult({
          is_correct: data.is_correct,
          score: data.score,
          already_submitted: true,
          selected_x_ratio: Number(data.selected_x_ratio),
          selected_y_ratio: Number(data.selected_y_ratio),
        });
      });
  }, [status, questionId, playerId, setCirclePosition, setSubmitResult]);
}
