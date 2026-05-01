import { useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useGameStore } from '../store/gameStore';
import type { Question } from '../lib/types';

/**
 * Fetches the current question whenever current_question_id changes.
 * Clears question when game returns to waiting state.
 */
export function useQuestion() {
  const questionId = useGameStore((s) => s.gameState?.current_question_id ?? null);
  const setQuestion = useGameStore((s) => s.setQuestion);

  useEffect(() => {
    if (!questionId) {
      setQuestion(null);
      return;
    }

    supabase
      .from('questions')
      .select(
        'id, order_index, text, image_url, circle_radius_ratio, time_limit_seconds, ' +
        'max_score, min_correct_score, image_width, image_height, reveal_image_url, ' +
        'is_published, created_at',
      )
      .eq('id', questionId)
      .single()
      .then(({ data, error }) => {
        if (error) {
          console.error('[useQuestion] fetch:', error.message);
          setQuestion(null);
          return;
        }
        if (data) setQuestion(data as unknown as Question);
      });
  }, [questionId, setQuestion]);
}
