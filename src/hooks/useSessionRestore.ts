import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useGameStore } from '../store/gameStore';

const PLAYER_ID_KEY = 'quiz_player_id';
const DISPLAY_NAME_KEY = 'quiz_display_name';
const SESSION_VERSION_KEY = 'quiz_session_version';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function clearSession() {
  localStorage.removeItem(PLAYER_ID_KEY);
  localStorage.removeItem(DISPLAY_NAME_KEY);
  localStorage.removeItem(SESSION_VERSION_KEY);
  useGameStore.setState({ playerId: null, displayName: null, isJoined: false });
}

/**
 * Runs once on app startup. Attempts to restore a previously joined player
 * session from localStorage + Supabase persisted auth.
 *
 * Returns { restoring: true } while the async check is in flight — callers
 * should show a loading state rather than JoinScreen during this window.
 *
 * Restore succeeds only when:
 *   1. localStorage has valid playerId + displayName
 *   2. Supabase auth session exists with the same user id
 *   3. saved session_version still matches the authoritative game_state version
 *   4. Player row can be safely reused or recreated for the current session
 *
 * On any failure, localStorage is cleared and the player sees JoinScreen.
 */
export function useSessionRestore() {
  const setSession = useGameStore((s) => s.setSession);
  const [restoring, setRestoring] = useState(true);

  useEffect(() => {
    const savedId = localStorage.getItem(PLAYER_ID_KEY);
    const savedName = localStorage.getItem(DISPLAY_NAME_KEY);
    const savedVersion = localStorage.getItem(SESSION_VERSION_KEY);

    // Validate stored values
    if (!savedId || !savedName || !UUID_RE.test(savedId) || savedName.trim().length === 0) {
      clearSession();
      setRestoring(false);
      return;
    }

    const restore = async () => {
      try {
        const { data: gs, error: gsErr } = await supabase
          .from('game_state')
          .select('session_version')
          .eq('id', '00000000-0000-0000-0000-000000000001')
          .single<{ session_version: number }>();

        if (gsErr || !gs) {
          console.error('[useSessionRestore] session_version fetch failed:', gsErr?.message);
          clearSession();
          setRestoring(false);
          return;
        }

        const hasStoredVersion = typeof savedVersion === 'string' && savedVersion.trim().length > 0;
        const storedVersionNum = hasStoredVersion ? parseInt(savedVersion, 10) : NaN;
        const versionMatches = Number.isFinite(storedVersionNum) && storedVersionNum === gs.session_version;

        if (hasStoredVersion && !versionMatches) {
          clearSession();
          setRestoring(false);
          return;
        }

        // Supabase persists the JWT in localStorage. getSession() reads it directly.
        const { data: { session } } = await supabase.auth.getSession();

        if (!session) {
          // Auth session expired or was cleared. Try to refresh silently.
          const { data } = await supabase.auth.refreshSession();
          if (!data.session) {
            clearSession();
            setRestoring(false);
            return;
          }
        }

        const currentSession = session ?? (await supabase.auth.getSession()).data.session;
        if (!currentSession) {
          clearSession();
          setRestoring(false);
          return;
        }

        // Auth uid must match stored playerId — if not, a new anonymous user
        // was created and we cannot safely restore the old session.
        if (currentSession.user.id !== savedId) {
          clearSession();
          setRestoring(false);
          return;
        }

        if (!hasStoredVersion) {
          // If the version is missing locally but the player row still exists,
          // allow restore without recreating anything. This covers a quick
          // refresh immediately after join before useSaveSessionVersion runs.
          const { data: existingPlayer, error: playerErr } = await supabase
            .from('players')
            .select('id')
            .eq('id', savedId)
            .maybeSingle<{ id: string }>();

          if (playerErr || !existingPlayer) {
            clearSession();
            setRestoring(false);
            return;
          }
        } else {
          // Session version matches, so restoring the player row is safe.
          const { error: upsertErr } = await supabase
            .from('players')
            .upsert(
              { id: savedId, display_name: savedName.trim() },
              { onConflict: 'id' },
            );

          if (upsertErr) {
            // Non-fatal: player row likely exists; proceed anyway.
            console.warn('[useSessionRestore] upsert warn:', upsertErr.message);
          }
        }

        setSession(savedId, savedName.trim());
      } catch (e) {
        console.error('[useSessionRestore] failed, showing JoinScreen:', e);
        clearSession();
      } finally {
        setRestoring(false);
      }
    };

    restore();
  }, [setSession]);

  return { restoring };
}
