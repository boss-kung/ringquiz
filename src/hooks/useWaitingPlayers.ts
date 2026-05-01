import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Player } from '../lib/types';

function sortPlayers(players: Player[]): Player[] {
  return [...players].sort((a, b) => {
    const joinedDiff = new Date(a.joined_at).getTime() - new Date(b.joined_at).getTime();
    if (joinedDiff !== 0) return joinedDiff;
    return a.display_name.localeCompare(b.display_name);
  });
}

export function useWaitingPlayers(enabled: boolean) {
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(enabled);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    let active = true;

    supabase
      .from('players')
      .select('id, display_name, total_score, joined_at')
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          console.error('[useWaitingPlayers] fetch:', error.message);
          setLoading(false);
          return;
        }
        setPlayers(sortPlayers((data ?? []) as Player[]));
        setLoading(false);
      });

    const channel = supabase
      .channel('waiting-room-players')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'players' },
        (payload) => {
          if (!active) return;

          if (payload.eventType === 'INSERT') {
            const nextPlayer = payload.new as Player;
            setPlayers((current) => sortPlayers([...current.filter((player) => player.id !== nextPlayer.id), nextPlayer]));
            return;
          }

          if (payload.eventType === 'UPDATE') {
            const nextPlayer = payload.new as Player;
            setPlayers((current) => sortPlayers(current.map((player) => (
              player.id === nextPlayer.id ? nextPlayer : player
            ))));
            return;
          }

          if (payload.eventType === 'DELETE') {
            const removedPlayer = payload.old as Player;
            setPlayers((current) => current.filter((player) => player.id !== removedPlayer.id));
          }
        },
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [enabled]);

  return {
    players,
    loading,
  };
}
