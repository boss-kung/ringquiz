import { useEffect } from 'react';
import { getSupabaseClient } from '../lib/supabase';
import { useGameStore } from '../store/gameStore';

export function useGameRealtime(gameId: string | null): void {
  const setGame = useGameStore((state) => state.setGame);
  const setPlayerConnected = useGameStore((state) => state.setPlayerConnected);

  useEffect(() => {
    if (!gameId) return;
    let channel: ReturnType<ReturnType<typeof getSupabaseClient>['channel']> | null = null;
    try {
      const client = getSupabaseClient();
      channel = client.channel(`treasure-game:${gameId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tq_games', filter: `id=eq.${gameId}` }, (payload) => {
          if (payload.new) setGame(payload.new as never);
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tq_player_profile' }, (payload) => {
          if (payload.new) setPlayerConnected(Boolean((payload.new as { auth_user_id?: string | null }).auth_user_id));
        })
        .subscribe();
    } catch {
      // Missing env is expected in local storybook/tests; the screen remains usable.
    }
    return () => {
      if (channel) void channel.unsubscribe();
    };
  }, [gameId, setGame, setPlayerConnected]);
}
