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
  const [remainingMs, setRemainingMs] = useState<number | null>(null);

  useEffect(() => {
  if (!endsAt) {
    setRemainingMs(null);
    return;
  }

  const endMs = new Date(endsAt).getTime();
  let rafId: number;

  const tick = () => {
    const diffMs = Math.max(0, endMs - getServerTime());
    setRemainingMs(diffMs);

    if (diffMs > 0) {
      rafId = requestAnimationFrame(tick);
    }
  };

  tick();

  return () => cancelAnimationFrame(rafId);
}, [endsAt, getServerTime]);

  if (remainingMs === null) return null;

const remainingSeconds = remainingMs / 1000;
const displaySeconds = remainingSeconds.toFixed(1);

const normalizedTotalMs =
  totalSeconds && totalSeconds > 0
    ? totalSeconds * 1000
    : remainingMs > 0
      ? remainingMs
      : 1000;

const pct = remainingMs > 0 ? Math.min(1, remainingMs / normalizedTotalMs) : 0;
const urgent = remainingSeconds <= 10;

  return (
    <div className={`flex items-center gap-2 rounded-full border px-3 py-2 font-mono text-xl font-bold tabular-nums ${
      urgent
        ? 'border-red-400/40 bg-red-500/10 text-red-300 timer-urgent-glow'
        : 'border-white/10 bg-white/[0.04] text-white'
    }`}>
    <span
      className="timer-digit min-w-[5.25ch] text-right"
    >
      {displaySeconds} วินาที
    </span>
      <div className="h-2 w-24 overflow-hidden rounded-full bg-white/15">
        <div
          className={`h-full rounded-full ${urgent ? 'bg-red-400' : 'bg-emerald-400'}`}
          style={{ width: `${pct * 100}%` }}
        />
      </div>
    </div>
  );
}
