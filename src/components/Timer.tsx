interface Props {
  remainingMs: number | null;
  totalMs: number | null;
  active?: boolean;
}

export function Timer({ remainingMs, totalMs, active = true }: Props) {
  if (remainingMs === null) return null;

  const clampedRemainingMs = Math.max(0, remainingMs);
  const durationMs = totalMs && totalMs > 0 ? totalMs : Math.max(clampedRemainingMs, 1);
  const remainingSeconds = clampedRemainingMs / 1000;
  const displaySeconds = remainingSeconds.toFixed(1);
  const progressPercent = Math.max(0, Math.min(100, (clampedRemainingMs / durationMs) * 100));
  const progressRatio = progressPercent / 100;
  const urgent = active && remainingSeconds <= 5;
  const critical = active && remainingSeconds <= 3;

  return (
    <div className={`gr-timer ${urgent ? 'gr-timer-urgent' : ''}${critical ? ' gr-timer-critical' : ''}`}>
      <div className="gr-timer-topline">
        <span
          className="gr-mono gr-timer-value timer-digit"
          style={{ minWidth: '4.5ch', textAlign: 'right' }}
        >
          {displaySeconds}s
        </span>
      </div>
      <div className="gr-timer-track" aria-hidden>
        <div
          className="gr-timer-fill"
          style={{
            transform: `scaleX(${progressRatio})`,
            background: urgent
              ? 'var(--rose)'
              : 'linear-gradient(90deg,#C49A1A,#F5C74A)',
          }}
        />
      </div>
    </div>
  );
}
