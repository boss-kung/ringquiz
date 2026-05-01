import { useEffect, useState } from 'react';
import { useGetServerTime } from '../hooks/useServerTime';

interface Props {
  endsAt: string | null; // ISO 8601 UTC from game_state.question_ends_at
  totalSeconds: number | null;
}

/**
 * Displays seconds remaining until question_ends_at.
 * Uses server-time offset for display accuracy.
 * The backend is the authoritative source for late-submission rejection.
 */
export function Timer({ endsAt, totalSeconds }: Props) {
  const getServerTime = useGetServerTime();
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (!endsAt) { setRemaining(null); return; }
    const endMs = new Date(endsAt).getTime();

    const tick = () => {
      const diff = Math.max(0, endMs - getServerTime());
      setRemaining(Math.ceil(diff / 1000));
    };

    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [endsAt, getServerTime]);

  if (remaining === null) return null;

  const normalizedTotalSeconds =
    totalSeconds && totalSeconds > 0 ? totalSeconds : remaining > 0 ? remaining : 1;
  const pct = remaining > 0 ? Math.min(1, remaining / normalizedTotalSeconds) : 0;
  const urgent = remaining <= 10;

  return (
    <div className={`flex items-center gap-2 rounded-full border px-3 py-2 font-mono text-xl font-bold tabular-nums ${
      urgent
        ? 'border-red-400/40 bg-red-500/10 text-red-300 animate-pulse'
        : 'border-white/10 bg-white/[0.04] text-white'
    }`}>
      <span>{remaining}s</span>
      <div className="h-2 w-24 overflow-hidden rounded-full bg-white/15">
        <div
          className={`h-full rounded-full transition-all ${urgent ? 'bg-red-400' : 'bg-emerald-400'}`}
          style={{ width: `${pct * 100}%` }}
        />
      </div>
    </div>
  );
}
