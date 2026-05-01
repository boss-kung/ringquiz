import { useEffect, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { COUNTDOWN_DISPLAY_SECONDS } from '../lib/constants';

export function CountdownScreen() {
  const question = useGameStore((s) => s.question);
  const [count, setCount] = useState(COUNTDOWN_DISPLAY_SECONDS);
  const progress = (COUNTDOWN_DISPLAY_SECONDS - count) / COUNTDOWN_DISPLAY_SECONDS;

  useEffect(() => {
    setCount(COUNTDOWN_DISPLAY_SECONDS);
    const id = setInterval(() => {
      setCount((c) => Math.max(0, c - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [question?.id]);

  return (
    <div className="relative flex min-h-full flex-col items-center justify-center overflow-hidden bg-slate-900 px-6 py-12 text-center">
      <div className="pointer-events-none absolute inset-0 opacity-60">
        <div className="waiting-glow waiting-glow-a" />
        <div className="waiting-glow waiting-glow-b" />
      </div>

      <div className="relative w-full max-w-md space-y-6">
        {question && (
          <p className="text-sm uppercase tracking-[0.32em] text-indigo-300/80">
            Question {question.order_index}
          </p>
        )}

        <div className="rounded-[32px] border border-white/10 bg-white/[0.04] px-6 py-8 shadow-2xl shadow-slate-950/30 backdrop-blur-sm">
          <p className="text-lg font-semibold text-slate-200">Get ready!</p>
          {question && (
            <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/35 px-4 py-4 text-left">
              <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Up next</p>
              <p className="mt-2 text-base font-semibold leading-snug text-white">
                {question.text}
              </p>
            </div>
          )}

          <div className="relative mx-auto mt-7 flex h-40 w-40 items-center justify-center">
            <div
              className="countdown-ring"
              style={{
                background: `conic-gradient(rgba(129,140,248,0.95) ${Math.min(360, progress * 360)}deg, rgba(255,255,255,0.08) 0deg)`,
              }}
            />
            <div className="absolute inset-[10px] rounded-full bg-slate-900/95 shadow-[inset_0_0_30px_rgba(15,23,42,0.9)]" />
            <div
              key={count}
              className="relative text-7xl font-black text-white animate-ping-once"
              style={{ animationDuration: '0.6s' }}
            >
              {count > 0 ? count : '🎯'}
            </div>
          </div>

          <p className="mt-5 text-sm text-slate-400">
            Place your marker as soon as the image opens.
          </p>
        </div>
      </div>
    </div>
  );
}
