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
        <p className="text-slate-400">กำลังโหลดคำถาม...</p>
      </div>
    );
  }

  const isLocked = submitted || submitting;
  const canSubmit = !!circlePosition && !isLocked && !timeExpired;
  const handleCircleChange = (pos: CirclePosition) => {
    if (!isLocked) setCirclePosition(pos);
  };

  return (
    <div className="flex min-h-full flex-col bg-slate-900">
      {/* Header */}
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

      {/* Question text */}
      <div className="shrink-0 px-4 py-4">
        <div className="rounded-3xl border border-white/10 bg-white/[0.04] px-4 py-4 shadow-xl shadow-slate-950/20">
          <p className="text-xl font-semibold leading-snug text-white sm:text-2xl">{question.text}</p>
        </div>
      </div>

      {/* Image + circle overlay — scrollable container */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="overflow-y-auto px-4 pb-4">
          <div className="py-2">
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
        <div className="space-y-2">
        {timeExpired && !submitted && !submitting && (
          <p className="text-center text-red-400 text-sm font-medium">หมดเวลา - คำตอบไม่ได้รับการบันทึก</p>
        )}

        {submitError && (
          <p className="text-center text-red-400 text-sm">{submitError}</p>
        )}

        {submitted && submitResult && (
          <p className="text-center text-emerald-400 text-sm font-medium">
            ✓ คำตอบถูกส่งแล้ว — กำลังรอผลลัพธ์
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
          {submitting ? 'กำลังส่ง...' : submitted ? 'ส่งแล้ว ✓' : 'ส่งคำตอบ'}
        </button>
      </div>
    </div>
  );
}
