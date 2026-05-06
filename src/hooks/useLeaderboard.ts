import { useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useGameStore } from '../store/gameStore';
import type { LeaderboardEntry } from '../lib/types';
import { LEADERBOARD_VISIBLE_ROWS } from '../lib/constants';

/**
 * Fetches the leaderboard snapshot when status is 'leaderboard' or 'ended'.
 * Always refreshes for the current question so late snapshot writes and
 * recomputes do not leave stale leaderboard rows on screen.
 */
export function useLeaderboard() {
  const status = useGameStore((s) => s.gameState?.status);
  const questionId = useGameStore((s) => s.gameState?.current_question_id);
  const playerId = useGameStore((s) => s.playerId);
  const setLeaderboard = useGameStore((s) => s.setLeaderboard);

  useEffect(() => {
    if (status !== 'leaderboard' && status !== 'ended') return;
    if (!questionId) return;

    let cancelled = false;

    const fetchLeaderboard = () => {
      supabase
        .from('leaderboard_snapshot')
        .select('question_id, player_id, rank, display_name, question_score, cumulative_score')
        .eq('question_id', questionId)
        .order('rank', { ascending: true })
        .limit(LEADERBOARD_VISIBLE_ROWS + 1) // +1 to detect if player is outside top N
        .then(({ data, error }) => {
          if (cancelled) return;
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
                if (cancelled) return;
                if (playerData) {
                  setLeaderboard([...entries, playerData as LeaderboardEntry], playerId);
                }
              });
          }
        });
    };

    fetchLeaderboard();
    const pollId = window.setInterval(fetchLeaderboard, 2500);
    const channel = supabase
      .channel(`player-leaderboard-${questionId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'leaderboard_snapshot',
        filter: `question_id=eq.${questionId}`,
      }, () => {
        fetchLeaderboard();
      })
      .subscribe();

    return () => {
      cancelled = true;
      window.clearInterval(pollId);
      supabase.removeChannel(channel);
    };
  }, [status, questionId, playerId, setLeaderboard]);
}
