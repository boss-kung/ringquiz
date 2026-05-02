import { useEffect, useMemo, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { COUNTDOWN_DISPLAY_SECONDS } from '../lib/constants';
import { useGetServerTime } from '../hooks/useServerTime';
import { resolveQuestionImageUrl } from '../lib/questionAssets';

export function CountdownScreen() {
  const question = useGameStore((s) => s.question);
  const gameState = useGameStore((s) => s.gameState);
  const getServerTime = useGetServerTime();
  const [count, setCount] = useState(COUNTDOWN_DISPLAY_SECONDS);
  const progress = (COUNTDOWN_DISPLAY_SECONDS - count) / COUNTDOWN_DISPLAY_SECONDS;
  const ringCircumference = 2 * Math.PI * 70;
  const ringOffset = ringCircumference * (1 - Math.max(0, Math.min(1, progress)));
  const countdownStartedAt = gameState?.updated_at ?? null;
  const cluePhase = count === 0;

  useEffect(() => {
    if (!countdownStartedAt) {
      setCount(COUNTDOWN_DISPLAY_SECONDS);
      return;
    }

    const countdownEndsAt = new Date(countdownStartedAt).getTime() + COUNTDOWN_DISPLAY_SECONDS * 1000;
    const syncCountdown = () => {
      const remainingMs = Math.max(0, countdownEndsAt - getServerTime());
      const nextCount = remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0;
      setCount(nextCount);
    };

    syncCountdown();
    const id = setInterval(syncCountdown, 200);
    return () => clearInterval(id);
  }, [countdownStartedAt, getServerTime, question?.id]);

  const clueImageUrl = useMemo(() => (
    question ? resolveQuestionImageUrl(question.image_url) : null
  ), [question]);

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
          {!cluePhase ? (
            <>
              <p className="text-lg font-semibold text-slate-200">Get ready!</p>

              <div className="relative mx-auto mt-7 flex h-40 w-40 items-center justify-center">
                <svg
                  className="countdown-ring"
                  viewBox="0 0 160 160"
                  aria-hidden
                >
                  <circle
                    cx="80"
                    cy="80"
                    r="70"
                    fill="none"
                    stroke="rgba(255,255,255,0.08)"
                    strokeWidth="10"
                  />
                  <circle
                    cx="80"
                    cy="80"
                    r="70"
                    fill="none"
                    stroke="rgba(129,140,248,0.95)"
                    strokeWidth="10"
                    strokeLinecap="round"
                    transform="rotate(-90 80 80)"
                    strokeDasharray={ringCircumference}
                    strokeDashoffset={ringOffset}
                    className="countdown-ring-progress"
                  />
                </svg>
                <div className="absolute inset-[12px] rounded-full bg-slate-900/95 shadow-[inset_0_0_30px_rgba(15,23,42,0.9)]" />
                <div
                  key={count}
                  className="relative min-w-[1.5ch] text-center text-7xl font-black text-white countdown-value"
                >
                  {count}
                </div>
              </div>

              <p className="mt-5 text-sm text-slate-400">
                The clue image will appear first.
              </p>
            </>
          ) : (
            <div className="space-y-4">
              <p className="text-lg font-semibold text-slate-200">Clue image</p>
              {clueImageUrl && (
                <div className="overflow-hidden rounded-[28px] border border-white/10 bg-slate-950/35 p-2 shadow-2xl shadow-slate-950/20">
                  <img
                    src={clueImageUrl}
                    alt="Clue"
                    className="block w-full h-auto rounded-[22px]"
                    draggable={false}
                  />
                </div>
              )}
              <p className="text-sm text-slate-400">
                Waiting for the host to open the question.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
