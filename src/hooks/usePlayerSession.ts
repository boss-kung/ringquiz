import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useGameStore } from '../store/gameStore';

const PLAYER_ID_KEY = 'quiz_player_id';
const DISPLAY_NAME_KEY = 'quiz_display_name';

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
    async (displayName: string) => {
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

        // Upsert player row (safe: display_name update is allowed by RLS)
        const { error: upsertErr } = await supabase
          .from('players')
          .upsert(
            { id: userId, display_name: displayName },
            { onConflict: 'id' },
          );
        if (upsertErr) throw new Error(upsertErr.message);

        // Persist for next visit
        localStorage.setItem(PLAYER_ID_KEY, userId);
        localStorage.setItem(DISPLAY_NAME_KEY, displayName);

        setSession(userId, displayName);
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
