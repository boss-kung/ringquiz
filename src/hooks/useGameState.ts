import { useEffect, useRef } from 'react';
import { supabase, GAME_STATE_ID } from '../lib/supabase';
import { REALTIME_CHANNEL } from '../lib/constants';
import { useGameStore } from '../store/gameStore';
import type { GameState } from '../lib/types';

/**
 * Fetches the initial game_state row and subscribes to Realtime UPDATE events.
 * Resets answer state whenever the active question changes.
 * Must be mounted once at the app root.
 */
export function useGameState() {
  const setGameState = useGameStore((s) => s.setGameState);
  const resetAnswerState = useGameStore((s) => s.resetAnswerState);
  const setRevealResult = useGameStore((s) => s.setRevealResult);
  const setLeaderboard = useGameStore((s) => s.setLeaderboard);
  const prevQuestionId = useRef<string | null>(null);

  useEffect(() => {
    // Initial fetch
    supabase
      .from('game_state')
      .select('*')
      .eq('id', GAME_STATE_ID)
      .single()
      .then(({ data, error }) => {
        if (error) console.error('[useGameState] initial fetch:', error.message);
        if (data) {
          setGameState(data as GameState);
          prevQuestionId.current = data.current_question_id;
        }
      });

    // Realtime subscription
    const channel = supabase
      .channel(REALTIME_CHANNEL)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'game_state',
          filter: `id=eq.${GAME_STATE_ID}`,
        },
        (payload) => {
          const gs = payload.new as GameState;
          setGameState(gs);

          // When question changes, wipe per-question state
          if (gs.current_question_id !== prevQuestionId.current) {
            resetAnswerState();
            setRevealResult(null);
            setLeaderboard([], null);
            prevQuestionId.current = gs.current_question_id;
          }
        },
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR') {
          console.error('[useGameState] Realtime channel error — will auto-reconnect');
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [setGameState, resetAnswerState, setRevealResult, setLeaderboard]);
}
