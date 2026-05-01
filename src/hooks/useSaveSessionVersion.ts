import { useEffect } from 'react';
import { useGameStore } from '../store/gameStore';

const SESSION_VERSION_KEY = 'quiz_session_version';

/**
 * Saves the current game_state.session_version to localStorage
 * whenever a player is joined and gameState is available.
 * This enables useSessionVersionCheck to detect hard resets.
 */
export function useSaveSessionVersion() {
  const playerId = useGameStore((s) => s.playerId);
  const gameState = useGameStore((s) => s.gameState);

  useEffect(() => {
    if (!playerId || !gameState) return;

    // Player is joined and game state is loaded — save the session version
    localStorage.setItem(SESSION_VERSION_KEY, String(gameState.session_version));
  }, [playerId, gameState?.session_version]);
}
