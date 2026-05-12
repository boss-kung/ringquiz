import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useGameStore } from '../store/gameStore';
import { triggerFeedbackFx } from '../lib/feedbackFx';
import { PLAYER_ID_KEY, DISPLAY_NAME_KEY, SESSION_VERSION_KEY } from '../lib/constants';

/**
 * Handles anonymous sign-in and player row upsert.
 * Reuses existing session from Supabase's persisted auth if available.
 * Stores display name in localStorage for UX continuity.
 */
export function usePlayerSession() {
  const setSession = useGameStore((s) => s.setSession);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const savedName = localStorage.getItem(DISPLAY_NAME_KEY) ?? '';

  const join = useCallback(
    async (displayName: string, emoji?: string) => {
      setLoading(true);
      setError(null);
      try {
        // Reuse existing session or sign in anonymously
        let { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          const { data, error: signInErr } = await supabase.auth.signInAnonymously();
          if (signInErr || !data.session) throw new Error(signInErr?.message ?? 'Auth failed');
          session = data.session;
        }

        const userId = session.user.id;

        // Prefix emoji so display screens (big screen, leaderboard) show it too
        const fullName = emoji ? `${emoji} ${displayName}` : displayName;

        const { error: joinErr } = await supabase.rpc('join_player', {
          display_name_input: fullName,
        });
        if (joinErr) throw new Error(joinErr.message);

        // Persist name without emoji so the input is pre-filled correctly next time
        localStorage.setItem(PLAYER_ID_KEY, userId);
        localStorage.setItem(DISPLAY_NAME_KEY, displayName);
        const currentVersion = useGameStore.getState().gameState?.session_version;
        if (currentVersion != null) {
          localStorage.setItem(SESSION_VERSION_KEY, String(currentVersion));
        }

        setSession(userId, fullName);
        window.setTimeout(() => triggerFeedbackFx('joinSuccess'), 0);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to join. Try again.');
      } finally {
        setLoading(false);
      }
    },
    [setSession],
  );

  return { join, loading, error, savedName };
}
