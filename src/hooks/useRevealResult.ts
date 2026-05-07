import { useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useGameStore } from '../store/gameStore';
import type { RevealResult } from '../lib/types';

/**
 * Fetches the player's own answer for the current question during reveal state.
 * Only runs when status === 'reveal'.
 * Sets revealNoAnswer = true if no answer row exists (player didn't submit).
 * revealResult and revealNoAnswer are intentionally excluded from deps to prevent
 * a set→re-run loop.
 */
export function useRevealResult() {
  const status = useGameStore((s) => s.gameState?.status);
  const questionId = useGameStore((s) => s.gameState?.current_question_id);
  const playerId = useGameStore((s) => s.playerId);
  const submitResult = useGameStore((s) => s.submitResult);
  const circlePosition = useGameStore((s) => s.circlePosition);
  const setRevealResult = useGameStore((s) => s.setRevealResult);
  const setRevealNoAnswer = useGameStore((s) => s.setRevealNoAnswer);

  useEffect(() => {
    if (status !== 'reveal' || !questionId || !playerId) return;

    // Local-first reveal: if this client already has the authoritative
    // submit result from the answer step, show it immediately and let the DB
    // fetch below act as background verification / refresh recovery.
    if (submitResult) {
      setRevealResult({
        is_correct: submitResult.is_correct,
        score: submitResult.score,
        selected_x_ratio: submitResult.selected_x_ratio ?? circlePosition?.xRatio ?? null,
        selected_y_ratio: submitResult.selected_y_ratio ?? circlePosition?.yRatio ?? null,
        special_rule_type: submitResult.special_rule_type ?? null,
        special_rule_config_snapshot: submitResult.special_rule_config_snapshot ?? null,
        score_breakdown: submitResult.score_breakdown ?? null,
        special_bonus_applied: submitResult.special_bonus_applied ?? false,
      });
    }

    supabase
      .from('answers')
      .select('is_correct, score, selected_x_ratio, selected_y_ratio, special_rule_type, special_rule_config_snapshot, score_breakdown, special_bonus_applied')
      .eq('player_id', playerId)
      .eq('question_id', questionId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) {
          console.error('[useRevealResult] fetch:', error.message);
          const fallbackX = circlePosition?.xRatio ?? submitResult?.selected_x_ratio ?? null;
          const fallbackY = circlePosition?.yRatio ?? submitResult?.selected_y_ratio ?? null;

          // Fall back to in-memory result, but only show a circle when we
          // actually have real coordinates from local state or submitResult.
          if (submitResult) {
            setRevealResult({
              is_correct: submitResult.is_correct,
              score: submitResult.score,
              selected_x_ratio: fallbackX,
              selected_y_ratio: fallbackY,
              special_rule_type: submitResult.special_rule_type ?? null,
              special_rule_config_snapshot: submitResult.special_rule_config_snapshot ?? null,
              score_breakdown: submitResult.score_breakdown ?? null,
              special_bonus_applied: submitResult.special_bonus_applied ?? false,
            });
          } else {
            setRevealNoAnswer(true);
          }
          return;
        }
        if (data) {
          setRevealResult(data as RevealResult);
        } else {
          // maybeSingle() returned null — player has no answer row for this question
          setRevealNoAnswer(true);
        }
      });
  }, [status, questionId, playerId, submitResult, circlePosition, setRevealResult, setRevealNoAnswer]);
}
