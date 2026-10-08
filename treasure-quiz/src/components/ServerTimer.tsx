import { useEffect, useRef, useState } from 'react';

interface ServerTimerProps { deadline: string | number | null; onExpire?: () => void; }

function deadlineMs(deadline: string | number | null): number | null {
  if (deadline === null) return null;
  const value = typeof deadline === 'number' ? deadline : Date.parse(deadline);
  return Number.isFinite(value) ? value : null;
}

export default function ServerTimer({ deadline, onExpire }: ServerTimerProps) {
  const target = deadlineMs(deadline);
  const [remainingMs, setRemainingMs] = useState(() => target === null ? 0 : Math.max(0, target - Date.now()));
  const expiredRef = useRef(false);
  useEffect(() => {
    expiredRef.current = false;
    if (target === null) return;
    const tick = () => {
      const remaining = Math.max(0, target - Date.now());
      setRemainingMs(remaining);
      if (remaining === 0 && !expiredRef.current) {
        expiredRef.current = true;
        onExpire?.();
      }
    };
    tick();
    const interval = window.setInterval(tick, 250);
    const resync = () => tick();
    window.addEventListener('focus', resync);
    document.addEventListener('visibilitychange', resync);
    return () => { window.clearInterval(interval); window.removeEventListener('focus', resync); document.removeEventListener('visibilitychange', resync); };
  }, [target, onExpire]);
  return <span className="server-timer" aria-live="polite">{target === null ? 'ไม่จำกัดเวลา' : remainingMs === 0 ? 'หมดเวลา' : `เหลือ ${Math.ceil(remainingMs / 1000)} วินาที`}</span>;
}
