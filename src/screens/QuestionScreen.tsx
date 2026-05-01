import { useEffect, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { useAnswerSubmit } from '../hooks/useAnswerSubmit';
import { useGetServerTime } from '../hooks/useServerTime';
import { QuestionImage } from '../components/QuestionImage';
import { Timer } from '../components/Timer';
import { resolveQuestionImageUrl } from '../lib/questionAssets';
import type { CirclePosition } from '../lib/types';

export function QuestionScreen() {
  const question = useGameStore((s) => s.question);
  const gameState = useGameStore((s) => s.gameState);
  const circlePosition = useGameStore((s) => s.circlePosition);
  const setCirclePosition = useGameStore((s) => s.setCirclePosition);
  const submitted = useGameStore((s) => s.submitted);
  const submitResult = useGameStore((s) => s.submitResult);
  const submitError = useGameStore((s) => s.submitError);
  const { submit, submitting } = useAnswerSubmit();
  const getServerTime = useGetServerTime();
  const [timeExpired, setTimeExpired] = useState(false);

  const endsAt = gameState?.question_ends_at ?? null;

  useEffect(() => {
    if (!endsAt) { setTimeExpired(false); return; }
    const endMs = new Date(endsAt).getTime();
    const tick = () => setTimeExpired(getServerTime() >= endMs);
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [endsAt, getServerTime]);

  if (!question) {
    return (
      <div className="flex items-center justify-center min-h-full bg-slate-900">
        <p className="text-slate-400">Loading question…</p>
      </div>
    );
  }

  const isLocked = submitted || submitting;
  const canSubmit = !!circlePosition && !isLocked && !timeExpired;
  const statusLabel = submitted
    ? 'Answer locked in'
    : submitting
      ? 'Submitting answer...'
      : timeExpired
        ? 'Time expired'
        : circlePosition
          ? 'Marker ready'
          : 'Place your marker';

  const handleCircleChange = (pos: CirclePosition) => {
    if (!isLocked) setCirclePosition(pos);
  };

  return (
    <div className="flex min-h-full flex-col bg-slate-900">
      {/* Header */}
      <div className="shrink-0 border-b border-white/10 bg-slate-800/95 px-4 py-3 backdrop-blur-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400">
              Question {question.order_index}
            </p>
            <p className={`mt-1 text-sm font-medium ${
              submitted
                ? 'text-emerald-300'
                : timeExpired
                  ? 'text-red-300'
                  : circlePosition
                    ? 'text-indigo-300'
                    : 'text-slate-300'
            }`}>
              {statusLabel}
            </p>
          </div>
          <Timer
            endsAt={gameState?.question_ends_at ?? null}
            totalSeconds={question.time_limit_seconds}
          />
        </div>
      </div>

      {/* Question text */}
      <div className="shrink-0 px-4 py-4">
        <div className="rounded-3xl border border-white/10 bg-white/[0.04] px-4 py-4 shadow-xl shadow-slate-950/20">
          <p className="text-base font-medium leading-snug text-white">{question.text}</p>
          <p className="mt-2 text-xs uppercase tracking-[0.22em] text-slate-500">
            Tap anywhere on the image to place your answer
          </p>
        </div>
      </div>

      {/* Image + circle overlay — scrollable container */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="overflow-y-auto px-4 pb-4">
          <div className="rounded-[28px] border border-white/10 bg-slate-950/35 p-2 shadow-2xl shadow-slate-950/20">
          <QuestionImage
            imageUrl={resolveQuestionImageUrl(question.image_url)}
            circleRadiusRatio={question.circle_radius_ratio}
            circle={circlePosition}
            onCircleChange={handleCircleChange}
            locked={isLocked}
          />
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="shrink-0 border-t border-white/10 bg-slate-800/95 px-4 py-4 backdrop-blur-sm">
        <div className="mb-3 flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Submission</p>
            <p className={`mt-1 text-sm font-semibold ${
              submitted
                ? 'text-emerald-300'
                : timeExpired
                  ? 'text-red-300'
                  : circlePosition
                    ? 'text-white'
                    : 'text-slate-300'
            }`}>
              {submitted
                ? 'Your answer is locked for this round'
                : timeExpired
                  ? 'The host can move on at any time'
                  : circlePosition
                    ? 'Marker placed. Review and submit when ready.'
                    : 'Choose the spot you think is correct.'}
            </p>
          </div>
          <div className={`h-3 w-3 rounded-full ${
            submitted
              ? 'bg-emerald-400 shadow-[0_0_16px_rgba(74,222,128,0.55)]'
              : timeExpired
                ? 'bg-red-400 shadow-[0_0_16px_rgba(248,113,113,0.45)]'
                : circlePosition
                  ? 'bg-indigo-400 shadow-[0_0_16px_rgba(129,140,248,0.55)]'
                  : 'bg-slate-500'
          }`} />
        </div>

        <div className="space-y-2">
        {timeExpired && !submitted && !submitting && (
          <p className="text-center text-red-400 text-sm font-medium">Time's up — answer not recorded</p>
        )}

        {!timeExpired && !circlePosition && !submitted && (
          <p className="text-center text-slate-400 text-sm">Tap the image to place your answer</p>
        )}

        {submitError && (
          <p className="text-center text-red-400 text-sm">{submitError}</p>
        )}

        {submitted && submitResult && (
          <p className="text-center text-emerald-400 text-sm font-medium">
            ✓ Answer submitted — waiting for results
          </p>
        )}
        </div>

        <button
          onClick={submit}
          disabled={!canSubmit}
          className="mt-3 w-full rounded-2xl bg-indigo-600 py-4 text-lg font-bold text-white shadow-lg shadow-indigo-950/35
            disabled:opacity-30 disabled:cursor-not-allowed
            active:scale-95 transition-transform"
        >
          {submitting ? 'Submitting…' : submitted ? 'Submitted ✓' : 'Submit Answer'}
        </button>
      </div>
    </div>
  );
}
