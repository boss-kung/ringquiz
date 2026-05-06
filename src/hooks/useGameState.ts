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
  const setQuestion = useGameStore((s) => s.setQuestion);
  const resetAnswerState = useGameStore((s) => s.resetAnswerState);
  const setRevealResult = useGameStore((s) => s.setRevealResult);
  const setLeaderboard = useGameStore((s) => s.setLeaderboard);
  const prevQuestionId = useRef<string | null>(null);
  const lastFetchAtRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    const applyGameState = (gs: GameState) => {
      if (cancelled) return;
      setGameState(gs);

      if (gs.current_question_id !== prevQuestionId.current) {
        setQuestion(null);
        resetAnswerState();
        setRevealResult(null);
        setLeaderboard([], null);
        prevQuestionId.current = gs.current_question_id;
      }
    };

    const refetchGameState = async (reason: 'initial' | 'poll' | 'reconnect') => {
      const now = Date.now();
      if (reason !== 'initial' && now - lastFetchAtRef.current < 750) return;
      lastFetchAtRef.current = now;

      const { data, error } = await supabase
        .from('game_state')
        .select('*')
        .eq('id', GAME_STATE_ID)
        .single();

      if (error) {
        console.error(`[useGameState] ${reason} fetch:`, error.message);
        return;
      }

      if (data) {
        applyGameState(data as GameState);
      }
    };

    void refetchGameState('initial');

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
          applyGameState(payload.new as GameState);
        },
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.error('[useGameState] Realtime channel error — will auto-reconnect');
          void refetchGameState('reconnect');
        }
      });

    const pollId = window.setInterval(() => {
      void refetchGameState('poll');
    }, 2500);

    const handleResume = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        void refetchGameState('reconnect');
      }
    };

    const handleOnline = () => {
      void refetchGameState('reconnect');
    };

    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', handleResume);

    return () => {
      cancelled = true;
      window.clearInterval(pollId);
      window.removeEventListener('online', handleOnline);
      document.removeEventListener('visibilitychange', handleResume);
      supabase.removeChannel(channel);
    };
  }, [setGameState, setQuestion, resetAnswerState, setRevealResult, setLeaderboard]);
}
