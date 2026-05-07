import { useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useGameStore } from '../store/gameStore';
import { PLAYER_ID_KEY } from '../lib/constants';
import type { Question } from '../lib/types';

type RuntimeQuestionRow = Omit<Question, 'play_order'>;
let gameSetSpecialRuleSupported: boolean | null = null;

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
    let retryTimer: number | null = null;

    const fetchAll = async () => {
      let { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        const hasSavedPlayerSession = Boolean(localStorage.getItem(PLAYER_ID_KEY));

        if (hasSavedPlayerSession) {
          const { data: refreshData, error: refreshErr } = await supabase.auth.refreshSession();
          session = refreshData.session;

          if (!session) {
            if (!cancelled) {
              console.warn('[useQuestion] auth restore pending:', refreshErr?.message ?? 'no session');
              setQuestion(null);
              retryTimer = window.setTimeout(() => { void fetchAll(); }, 1500);
            }
            return;
          }
        } else {
          const { data: signInData, error: signInErr } = await supabase.auth.signInAnonymously();
          session = signInData.session;

          if (signInErr || !session) {
            if (!cancelled) {
              console.error('[useQuestion] auth:', signInErr?.message ?? 'anonymous sign-in failed');
              setQuestion(null);
              retryTimer = window.setTimeout(() => { void fetchAll(); }, 1500);
            }
            return;
          }
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
        if (!cancelled) {
          retryTimer = window.setTimeout(() => { void fetchAll(); }, 1500);
        }
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
        // Two-step fetch: core fields first (always present), then special_rule fields
        // separately so a missing column (migration pending) never blocks the question load.
        const { data: gsqData, error: gsqErr } = await supabase
          .from('game_set_questions')
          .select('play_order, time_limit_seconds, max_score, min_correct_score, circle_radius_ratio')
          .eq('id', gsqId)
          .single<Pick<Question, 'play_order' | 'time_limit_seconds' | 'max_score' | 'min_correct_score' | 'circle_radius_ratio'>>();

        if (!cancelled && gsqErr) {
          console.warn('[useQuestion] game_set overlay fetch:', gsqErr.message);
        }

        if (!cancelled && gsqData) {
          merged = {
            ...merged,
            play_order: gsqData.play_order,
            time_limit_seconds: gsqData.time_limit_seconds,
            max_score: gsqData.max_score,
            min_correct_score: gsqData.min_correct_score,
            circle_radius_ratio: gsqData.circle_radius_ratio,
            special_rule_type: 'normal',
            special_rule_config: {},
          };

          // Fetch special-rule fields separately — columns may not exist until migration is applied.
          if (gameSetSpecialRuleSupported !== false) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data: srData, error: srErr } = await (supabase as any)
              .from('game_set_questions')
              .select('special_rule_type, special_rule_config')
              .eq('id', gsqId)
              .single() as {
                data: { special_rule_type?: string; special_rule_config?: Record<string, unknown> | null } | null;
                error: { message?: string } | null;
              };

            if (srErr && (srErr.message ?? '').includes('does not exist')) {
              gameSetSpecialRuleSupported = false;
            } else if (!srErr) {
              gameSetSpecialRuleSupported = true;
            }

            if (!cancelled && srData?.special_rule_type) {
              merged = {
                ...merged,
                special_rule_type: (srData.special_rule_type as import('../lib/types').SpecialRuleType),
                special_rule_config: (srData.special_rule_config as import('../lib/types').SpecialRuleConfig | null) ?? {},
              };
            }
          }
        }
      }

      if (!cancelled) setQuestion(merged);
    };

    void fetchAll();

    return () => {
      cancelled = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    };
  }, [questionId, gsqId, currentIndex, setQuestion]);
}
