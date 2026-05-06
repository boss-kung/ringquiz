import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { useAnswerSubmit } from '../hooks/useAnswerSubmit';
import { useGetServerTime } from '../hooks/useServerTime';
import { QuestionImage } from '../components/QuestionImage';
import { Timer } from '../components/Timer';
import { resolveQuestionImageUrl } from '../lib/questionAssets';
import type { CirclePosition } from '../lib/types';
import { triggerFeedbackFx, unlockFeedbackAudio } from '../lib/feedbackFx';
import { FUNCTIONS_URL, supabase } from '../lib/supabase';

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
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const [buttonPressed, setButtonPressed] = useState(false);
  const warmedQuestionIdRef = useRef<string | null>(null);

  const endsAt = gameState?.question_ends_at ?? null;
  const displayOrder = question?.play_order ?? question?.order_index ?? gameState?.current_question_index ?? null;
  const durationMs = (question?.time_limit_seconds ?? 0) * 1000;

  useEffect(() => {
    if (!endsAt) {
      setRemainingMs(null);
      return;
    }

    const endMs = new Date(endsAt).getTime();
    let rafId = 0;

    const tick = () => {
      const diffMs = Math.max(0, endMs - getServerTime());
      setRemainingMs(diffMs);
      if (diffMs > 0) {
        rafId = requestAnimationFrame(tick);
      }
    };

    tick();
    return () => cancelAnimationFrame(rafId);
  }, [endsAt, getServerTime]);

  const timeExpired = remainingMs !== null && remainingMs <= 0;

  useEffect(() => {
    if (timeExpired && !submitted) {
      triggerFeedbackFx('timeout');
    }
  }, [timeExpired, submitted]);

  useEffect(() => {
    if (!question?.id) return;
    if (warmedQuestionIdRef.current === question.id) return;
    warmedQuestionIdRef.current = question.id;

    let cancelled = false;
    const warm = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session || cancelled) return;

      try {
        await fetch(`${FUNCTIONS_URL}/submit-answer?question_id=${encodeURIComponent(question.id)}`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
          },
        });
      } catch {
        // Best-effort warm-up only; ignore failures.
      }
    };

    void warm();
    return () => {
      cancelled = true;
    };
  }, [question?.id]);

  if (!question) {
    return (
      <div style={{ display: 'flex', minHeight: '100%', alignItems: 'center', justifyContent: 'center', background: 'var(--navy)' }}>
        <p style={{ color: 'var(--text-2)' }}>กำลังโหลดคำถาม...</p>
      </div>
    );
  }

  const isLocked = submitted || submitting;
  const canSubmit = Boolean(circlePosition) && !isLocked && !timeExpired;
  const questionImageUrl = resolveQuestionImageUrl(question.image_url);

  const handleCircleChange = (pos: CirclePosition) => {
    if (!isLocked) setCirclePosition(pos);
  };

  const handleInteractionStart = (clientX: number, clientY: number) => {
    void unlockFeedbackAudio();
    triggerFeedbackFx('answerTap', { clientX, clientY });
  };

  const handleSubmitPress = () => {
    if (!canSubmit) return;
    setButtonPressed(true);
    void submit();
  };

  return (
    <div style={{ display: 'flex', minHeight: '100%', flexDirection: 'column', background: 'var(--navy)' }}>
      {/* Header */}
      <div className="gr-qhud-wrap">
        <div className="gr-qhud-order">Question {displayOrder ?? '—'}</div>
        <Timer
          remainingMs={remainingMs}
          totalMs={durationMs}
        />
      </div>

      {/* Question text */}
      <div className="gr-qtext-wrap">
        <div className="gr-card gr-qtext-card">
          <p className="gr-qtext">
            {question.text}
          </p>
        </div>
      </div>

      {/* Image area */}
      <div className="gr-qimage-wrap">
        <div className="quiz-image-stage">
          <QuestionImage
            imageUrl={questionImageUrl}
            circleRadiusRatio={question.circle_radius_ratio}
            circle={circlePosition}
            onCircleChange={handleCircleChange}
            onInteractionStart={handleInteractionStart}
            locked={isLocked}
            shellClassName="quiz-image-shell--question"
          />
        </div>
      </div>

      {/* Submit bar */}
      <div
        className="gr-qsubmit"
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
          onClick={handleSubmitPress}
          onPointerDown={() => {
            if (canSubmit) setButtonPressed(true);
          }}
          onPointerUp={() => setButtonPressed(false)}
          onPointerCancel={() => setButtonPressed(false)}
          onBlur={() => setButtonPressed(false)}
          disabled={!canSubmit}
          className={`gr-btn ${submitted ? 'gr-btn-submit-done' : 'gr-btn-gold'}${buttonPressed ? ' gr-btn-is-pressing' : ''}`}
          style={{ marginTop: 0 }}
        >
          {submitting ? 'กำลังส่ง...' : submitted ? '✓ ส่งแล้ว' : circlePosition ? 'ส่งคำตอบ' : 'แตะที่ภาพเพื่อตอบ'}
        </button>
      </div>
    </div>
  );
}
