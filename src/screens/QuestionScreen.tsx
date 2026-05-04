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
      <div style={{ display: 'flex', minHeight: '100%', alignItems: 'center', justifyContent: 'center', background: 'var(--navy)' }}>
        <p style={{ color: 'var(--text-2)' }}>กำลังโหลดคำถาม...</p>
      </div>
    );
  }

  const isLocked = submitted || submitting;
  const canSubmit = Boolean(circlePosition) && !isLocked && !timeExpired;

  const handleCircleChange = (pos: CirclePosition) => {
    if (!isLocked) setCirclePosition(pos);
  };

  return (
    <div style={{ display: 'flex', minHeight: '100%', flexDirection: 'column', background: 'var(--navy)' }}>
      {/* Header */}
      <div className="gr-header">
        <p className="gr-label-xs">Question {question.order_index}</p>
        <Timer
          endsAt={gameState?.question_ends_at ?? null}
          totalSeconds={question.time_limit_seconds}
        />
      </div>

      {/* Question text */}
      <div style={{ flexShrink: 0, padding: '8px 14px 6px' }}>
        <div className="gr-card" style={{ padding: '13px 16px' }}>
          <p style={{ fontSize: 18, fontWeight: 600, lineHeight: 1.5, color: 'var(--text)' }}>
            {question.text}
          </p>
        </div>
      </div>

      {/* Image area */}
      <div style={{ flex: 1, minHeight: 0, padding: '6px 16px' }}>
        <div className="quiz-image-stage">
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

      {/* Submit bar */}
      <div
        style={{
          flexShrink: 0,
          borderTop: '1px solid var(--border)',
          background: 'rgba(8,13,28,.92)',
          backdropFilter: 'blur(12px)',
          padding: '8px 16px 16px',
        }}
      >
        <div style={{ marginBottom: submitted || timeExpired || submitError ? 8 : 0 }}>
          {timeExpired && !submitted && !submitting && (
            <p style={{ textAlign: 'center', fontSize: 12, fontWeight: 600, color: 'var(--rose)', marginBottom: 6 }}>
              หมดเวลา — คำตอบไม่ได้รับการบันทึก
            </p>
          )}
          {submitError && (
            <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--rose)', marginBottom: 6 }}>{submitError}</p>
          )}
          {submitted && submitResult && (
            <p style={{ textAlign: 'center', fontSize: 12, fontWeight: 600, color: 'var(--emerald)', marginBottom: 6 }}>
              ✓ คำตอบถูกส่งแล้ว — กำลังรอผลลัพธ์
            </p>
          )}
        </div>

        <button
          onClick={submit}
          disabled={!canSubmit}
          className={`gr-btn ${submitted ? 'gr-btn-submit-done' : 'gr-btn-gold'}`}
          style={{ marginTop: 0 }}
        >
          {submitting ? 'กำลังส่ง...' : submitted ? '✓ ส่งแล้ว' : circlePosition ? 'ส่งคำตอบ' : 'แตะที่ภาพเพื่อตอบ'}
        </button>
      </div>
    </div>
  );
}
