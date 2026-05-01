import { useEffect, useCallback } from 'react';
import { FUNCTIONS_URL } from '../lib/supabase';
import { SERVER_TIME_RESYNC_INTERVAL_MS } from '../lib/constants';
import { useGameStore } from '../store/gameStore';
import type { ServerTimeResponse } from '../lib/types';

export function useServerTime() {
  const setServerTimeOffset = useGameStore((s) => s.setServerTimeOffset);

  const sync = useCallback(async () => {
    try {
      const t0 = Date.now();
      const res = await fetch(`${FUNCTIONS_URL}/server-time`);
      if (!res.ok) return;
      const data: ServerTimeResponse = await res.json();
      const t1 = Date.now();
      // Estimate server time at midpoint of round trip
      const rtt = t1 - t0;
      const estimatedServerNow = data.server_time_ms + rtt / 2;
      setServerTimeOffset(estimatedServerNow - t1);
    } catch {
      // Non-critical: leave offset at 0; timer is display-only
    }
  }, [setServerTimeOffset]);

  useEffect(() => {
    sync();
    const id = setInterval(sync, SERVER_TIME_RESYNC_INTERVAL_MS);
    return () => clearInterval(id);
  }, [sync]);
}

/** Returns current estimated server time in ms. */
export function useGetServerTime() {
  const offset = useGameStore((s) => s.serverTimeOffset);
  return useCallback(() => Date.now() + offset, [offset]);
}
