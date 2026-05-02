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
    if (!endsAt) {
      setTimeExpired(false);
      return;
    }

    const endMs = new Date(endsAt).getTime();
    const tick = () => setTimeExpired(getServerTime() >= endMs);

    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [endsAt, getServerTime]);

  if (!question) {
    return (
      <div className="flex min-h-full items-center justify-center bg-slate-900">
        <p className="text-slate-400">กำลังโหลดคำถาม...</p>
      </div>
    );
  }

  const isLocked = submitted || submitting;
  const canSubmit = Boolean(circlePosition) && !isLocked && !timeExpired;

  const handleCircleChange = (pos: CirclePosition) => {
    if (!isLocked) {
      setCirclePosition(pos);
    }
  };

  return (
    <div className="flex min-h-full flex-col bg-slate-900">
      <div className="shrink-0 border-b border-white/10 bg-slate-800/95 px-4 py-3 backdrop-blur-sm">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400">
            Question {question.order_index}
          </p>
          <Timer
            endsAt={gameState?.question_ends_at ?? null}
            totalSeconds={question.time_limit_seconds}
          />
        </div>
      </div>

      <div className="shrink-0 px-4 py-4">
        <div className="rounded-3xl border border-white/10 bg-white/[0.04] px-4 py-4 shadow-xl shadow-slate-950/20">
          <p className="text-xl font-semibold leading-snug text-white sm:text-2xl">
            {question.text}
          </p>
        </div>
      </div>

      <div className="flex-1 min-h-0 px-1 py-2 sm:px-4 sm:py-4">
        <div className="flex h-full items-center justify-center overflow-hidden">
          <QuestionImage
            imageUrl={resolveQuestionImageUrl(question.image_url)}
            circleRadiusRatio={question.circle_radius_ratio}
            circle={circlePosition}
            onCircleChange={handleCircleChange}
            locked={isLocked}
            shellClassName="quiz-image-shell--question"
          />
        </div>
      </div>

      <div className="shrink-0 border-t border-white/10 bg-slate-800/95 px-4 py-4 backdrop-blur-sm">
        <div className="space-y-2">
          {timeExpired && !submitted && !submitting && (
            <p className="text-center text-sm font-medium text-red-400">
              หมดเวลา - คำตอบไม่ได้รับการบันทึก
            </p>
          )}

          {submitError && (
            <p className="text-center text-sm text-red-400">{submitError}</p>
          )}

          {submitted && submitResult && (
            <p className="text-center text-sm font-medium text-emerald-400">
              ✓ คำตอบถูกส่งแล้ว — กำลังรอผลลัพธ์
            </p>
          )}
        </div>

        <button
          onClick={submit}
          disabled={!canSubmit}
          className="mt-3 w-full rounded-2xl bg-indigo-600 py-4 text-lg font-bold text-white shadow-lg shadow-indigo-950/35 transition-transform active:scale-95 disabled:cursor-not-allowed disabled:opacity-30"
        >
          {submitting ? 'กำลังส่ง...' : submitted ? 'ส่งแล้ว ✓' : 'ส่งคำตอบ'}
        </button>
      </div>
    </div>
  );
}
