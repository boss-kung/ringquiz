import { useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useGameStore } from '../store/gameStore';
import type { LeaderboardEntry } from '../lib/types';
import { LEADERBOARD_VISIBLE_ROWS } from '../lib/constants';

/**
 * Fetches the leaderboard snapshot when status is 'leaderboard' or 'ended'.
 * Only fetches if we don't already have entries for the current question.
 */
export function useLeaderboard() {
  const status = useGameStore((s) => s.gameState?.status);
  const questionId = useGameStore((s) => s.gameState?.current_question_id);
  const playerId = useGameStore((s) => s.playerId);
  const setLeaderboard = useGameStore((s) => s.setLeaderboard);

  useEffect(() => {
    if (status !== 'leaderboard' && status !== 'ended') return;
    if (!questionId) return;

    supabase
      .from('leaderboard_snapshot')
      .select('question_id, player_id, rank, display_name, question_score, cumulative_score')
      .eq('question_id', questionId)
      .order('rank', { ascending: true })
      .limit(LEADERBOARD_VISIBLE_ROWS + 1) // +1 to detect if player is outside top N
      .then(({ data, error }) => {
        if (error) {
          console.error('[useLeaderboard] fetch:', error.message);
          return;
        }
        const entries = (data ?? []) as LeaderboardEntry[];
        setLeaderboard(entries, playerId);

        // If player is not in top results, fetch their specific entry
        if (playerId && !entries.find((e) => e.player_id === playerId)) {
          supabase
            .from('leaderboard_snapshot')
            .select('question_id, player_id, rank, display_name, question_score, cumulative_score')
            .eq('question_id', questionId)
            .eq('player_id', playerId)
            .maybeSingle()
            .then(({ data: playerData }) => {
              if (playerData) {
                setLeaderboard([...entries, playerData as LeaderboardEntry], playerId);
              }
            });
        }
      });
  }, [status, questionId, playerId, setLeaderboard]);
}
