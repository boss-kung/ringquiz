import { useEffect, useState } from 'react';
import { useGetServerTime } from '../hooks/useServerTime';

interface Props {
  endsAt: string | null;
  totalSeconds: number | null;
}

export function Timer({ endsAt, totalSeconds }: Props) {
  const getServerTime = useGetServerTime();
  const [remainingMs, setRemainingMs] = useState<number | null>(null);

  useEffect(() => {
    if (!endsAt) { setRemainingMs(null); return; }

    const endMs = new Date(endsAt).getTime();
    let rafId: number;

    const tick = () => {
      const diffMs = Math.max(0, endMs - getServerTime());
      setRemainingMs(diffMs);
      if (diffMs > 0) rafId = requestAnimationFrame(tick);
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
      : remainingMs > 0 ? remainingMs : 1000;

  const pct = remainingMs > 0 ? Math.min(1, remainingMs / normalizedTotalMs) : 0;
  const urgent = remainingSeconds <= 10;

  return (
    <div className={`gr-timer ${urgent ? 'gr-timer-urgent' : ''}`}>
      <span
        className="gr-mono timer-digit"
        style={{ minWidth: '4.5ch', textAlign: 'right' }}
      >
        {displaySeconds}s
      </span>
      <div className="gr-timer-track">
        <div
          className="gr-timer-fill"
          style={{
            width: `${pct * 100}%`,
            background: urgent
              ? 'var(--rose)'
              : 'linear-gradient(90deg,#C49A1A,#F5C74A)',
          }}
        />
      </div>
    </div>
  );
}
