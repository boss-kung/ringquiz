import { useEffect } from 'react';
import { useGameStore } from '../store/gameStore';

const SESSION_VERSION_KEY = 'quiz_session_version';
const PLAYER_ID_KEY = 'quiz_player_id';
const DISPLAY_NAME_KEY = 'quiz_display_name';

/**
 * Watches for hard reset (session_version increment in game_state).
 * If detected, clears local session and forces player back to JoinScreen.
 * Runs on app startup and whenever game_state.session_version changes.
 */
export function useSessionVersionCheck() {
  const gameState = useGameStore((s) => s.gameState);

  useEffect(() => {
    if (!gameState) return;

    const storedVersion = localStorage.getItem(SESSION_VERSION_KEY);
    if (!storedVersion) return; // No prior session to compare

    const storedVersionNum = parseInt(storedVersion, 10);
    if (storedVersionNum !== gameState.session_version) {
      // Mismatch detected — hard reset occurred. Clear all session data.
      localStorage.removeItem(PLAYER_ID_KEY);
      localStorage.removeItem(DISPLAY_NAME_KEY);
      localStorage.removeItem(SESSION_VERSION_KEY);

      // Trigger re-render to JoinScreen by clearing player session from store
      const { playerId } = useGameStore.getState();
      if (playerId) {
        // Reset store to initial player state (isJoined: false)
        useGameStore.setState({ playerId: null, displayName: null, isJoined: false });
      }
    }
  }, [gameState?.session_version]);
}
