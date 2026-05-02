import { useEffect, useMemo, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { COUNTDOWN_DISPLAY_SECONDS } from '../lib/constants';
import { resolveQuestionImageUrl } from '../lib/questionAssets';

export function CountdownScreen() {
  const question = useGameStore((s) => s.question);
  const gameState = useGameStore((s) => s.gameState);
const totalCountdownMs = COUNTDOWN_DISPLAY_SECONDS * 1000;

const [remainingMs, setRemainingMs] = useState(totalCountdownMs);
const [count, setCount] = useState(COUNTDOWN_DISPLAY_SECONDS);
const [showClue, setShowClue] = useState(false);

const progress = Math.max(
  0,
  Math.min(1, (totalCountdownMs - remainingMs) / totalCountdownMs)
);

const ringCircumference = 2 * Math.PI * 70;
const ringOffset = progress >= 1 ? 0 : ringCircumference * (1 - progress);

const countdownStartedAt = gameState?.updated_at ?? null;
const cluePhase = showClue;

  useEffect(() => {
  setShowClue(false);
  setRemainingMs(totalCountdownMs);
  setCount(COUNTDOWN_DISPLAY_SECONDS);

  if (!countdownStartedAt) {
    return;
  }

  const visualStartedAt = performance.now();

  let animationFrameId = 0;
  let clueTimerId: ReturnType<typeof setTimeout> | null = null;

  const syncCountdown = () => {
    const elapsedMs = performance.now() - visualStartedAt;
    const nextRemainingMs = Math.max(0, totalCountdownMs - elapsedMs);

    if (nextRemainingMs <= 0) {
      setRemainingMs(0);
      setCount(0);

      if (!clueTimerId) {
        clueTimerId = setTimeout(() => {
          setShowClue(true);
        }, 350);
      }

      return;
    }

    setRemainingMs(nextRemainingMs);
    setCount(Math.ceil(nextRemainingMs / 1000));

    animationFrameId = requestAnimationFrame(syncCountdown);
  };

  animationFrameId = requestAnimationFrame(syncCountdown);

  return () => {
    cancelAnimationFrame(animationFrameId);

    if (clueTimerId) {
      clearTimeout(clueTimerId);
    }
  };
}, [
  countdownStartedAt,
  question?.id,
  totalCountdownMs,
]);

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
              <p className="text-lg font-semibold text-slate-200">เตรียมพร้อม!</p>

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
                    style={{ transition: 'none' }}
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
            </>
          ) : (
            <div className="space-y-4">
              <p className="text-lg font-semibold text-slate-200">ภาพปริศนา</p>
              {clueImageUrl && (
                <div className="question-orb-shell mx-auto max-w-[24rem]">
                  <div className="question-orb-glow" aria-hidden />
                  <div className="question-orb-offset-ring" aria-hidden />
                  <div className="question-orb-main-ring" aria-hidden />
                  <div className="question-orb-stage">
                  <img
                    src={clueImageUrl}
                    alt="Clue"
                    className="h-full w-full object-cover"
                    draggable={false}
                  />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
