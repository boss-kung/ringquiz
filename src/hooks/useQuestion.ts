import { useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useGameStore } from '../store/gameStore';
import { PLAYER_ID_KEY } from '../lib/constants';
import type { Question } from '../lib/types';

type RuntimeQuestionRow = Omit<Question, 'play_order'>;

/**
 * Fetches the current question whenever current_question_id changes.
 * If current_game_set_question_id is set, overlays the game-set snapshot
 * values (circle_radius_ratio, time_limit_seconds, max_score, min_correct_score)
 * so the player UI uses the correct runtime values rather than bank defaults.
 * Clears question when game returns to waiting state.
 */
export function useQuestion() {
  const questionId      = useGameStore((s) => s.gameState?.current_question_id ?? null);
  const gsqId           = useGameStore((s) => s.gameState?.current_game_set_question_id ?? null);
  const currentIndex    = useGameStore((s) => s.gameState?.current_question_index ?? null);
  const setQuestion     = useGameStore((s) => s.setQuestion);

  useEffect(() => {
    if (!questionId) {
      setQuestion(null);
      return;
    }

    let cancelled = false;

    const fetchAll = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        const hasSavedPlayerSession = Boolean(localStorage.getItem(PLAYER_ID_KEY));
        if (hasSavedPlayerSession) {
          if (!cancelled) setQuestion(null);
          return;
        }

        const { error: signInErr } = await supabase.auth.signInAnonymously();
        if (signInErr) {
          if (!cancelled) {
            console.error('[useQuestion] auth:', signInErr.message);
            setQuestion(null);
          }
          return;
        }
      }

      // Fetch bank question content
      const { data: questionData, error: qErr } = await supabase
        .from('questions')
        .select(
          'id, order_index, text, image_url, circle_radius_ratio, time_limit_seconds, ' +
          'max_score, min_correct_score, image_width, image_height, reveal_image_url, ' +
          'is_published, created_at',
        )
        .eq('id', questionId)
        .single<RuntimeQuestionRow>();

      if (cancelled) return;

      if (qErr || !questionData) {
        console.error('[useQuestion] fetch:', qErr?.message);
        setQuestion(null);
        return;
      }

      let merged = {
        ...(questionData as unknown as Question),
        play_order: currentIndex ?? questionData.order_index,
      };

      // Overlay game-set snapshot values when a game-set question is active.
      // This ensures circle_radius_ratio and timing shown to the player match
      // what the server will use for correctness evaluation.
      if (gsqId) {
        const { data: gsqData } = await supabase
          .from('game_set_questions')
          .select('play_order, time_limit_seconds, max_score, min_correct_score, circle_radius_ratio')
          .eq('id', gsqId)
          .single<Pick<Question, 'play_order' | 'time_limit_seconds' | 'max_score' | 'min_correct_score' | 'circle_radius_ratio'>>();

        if (!cancelled && gsqData) {
          merged = {
            ...merged,
            play_order: gsqData.play_order,
            time_limit_seconds: gsqData.time_limit_seconds,
            max_score: gsqData.max_score,
            min_correct_score: gsqData.min_correct_score,
            circle_radius_ratio: gsqData.circle_radius_ratio,
          };
        }
      }

      if (!cancelled) setQuestion(merged);
    };

    void fetchAll();

    return () => { cancelled = true; };
  }, [questionId, gsqId, currentIndex, setQuestion]);
}
