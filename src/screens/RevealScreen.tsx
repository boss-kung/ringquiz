import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { useRevealResult } from '../hooks/useRevealResult';
import { useGetServerTime } from '../hooks/useServerTime';
import { QuestionImage } from '../components/QuestionImage';
import { FUNCTIONS_URL } from '../lib/supabase';
import { resolveQuestionImageUrl, resolveRevealImageUrl } from '../lib/questionAssets';
import { triggerFeedbackFx } from '../lib/feedbackFx';

export function RevealScreen() {
  useRevealResult();

  const question = useGameStore((s) => s.question);
  const revealResult = useGameStore((s) => s.revealResult);
  const revealNoAnswer = useGameStore((s) => s.revealNoAnswer);
  const circlePosition = useGameStore((s) => s.circlePosition);
  const submitResult = useGameStore((s) => s.submitResult);
  const gameState = useGameStore((s) => s.gameState);
  const getServerTime = useGetServerTime();
  const [showRevealImage, setShowRevealImage] = useState(false);
  const [revealImageReady, setRevealImageReady] = useState(false);
  const revealStartedAt = gameState?.updated_at ?? null;
  const feedbackFiredRef = useRef(false);

  useEffect(() => {
    if (!question || !revealStartedAt) {
      setShowRevealImage(false);
      return;
    }
    const revealImageAtMs = new Date(revealStartedAt).getTime() + 5000;
    const syncRevealPhase = () => setShowRevealImage(getServerTime() >= revealImageAtMs);
    syncRevealPhase();
    const id = setInterval(syncRevealPhase, 200);
    return () => clearInterval(id);
  }, [revealStartedAt, getServerTime, question?.id]);

  const effectiveRevealResult = revealResult ?? (
    submitResult
      ? {
          is_correct: submitResult.is_correct,
          score: submitResult.score,
          selected_x_ratio: submitResult.selected_x_ratio ?? circlePosition?.xRatio ?? null,
          selected_y_ratio: submitResult.selected_y_ratio ?? circlePosition?.yRatio ?? null,
        }
      : null
  );

  useEffect(() => {
    if (!effectiveRevealResult) {
      feedbackFiredRef.current = false;
      return;
    }
    if (feedbackFiredRef.current) return;
    feedbackFiredRef.current = true;
    triggerFeedbackFx(effectiveRevealResult.is_correct ? 'answerCorrect' : 'answerWrong');
  }, [effectiveRevealResult?.is_correct, effectiveRevealResult?.score]);

  if (!question) {
    return (
      <div style={{ display: 'flex', minHeight: '100%', alignItems: 'center', justifyContent: 'center', background: 'var(--navy)' }}>
        <p style={{ color: 'var(--text-2)' }}>กำลังโหลดข้อมูล...</p>
      </div>
    );
  }

  const isCorrect = effectiveRevealResult?.is_correct ?? false;
  const originalQuestionImage = resolveQuestionImageUrl(question.image_url);
  const revealBaseImage =
    resolveRevealImageUrl(question.reveal_image_url) ??
    originalQuestionImage;

  useEffect(() => {
    if (!revealBaseImage || revealBaseImage === originalQuestionImage) {
      setRevealImageReady(true);
      return;
    }

    setRevealImageReady(false);
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (!cancelled) setRevealImageReady(true);
    };
    img.onerror = () => {
      if (!cancelled) setRevealImageReady(true);
    };
    img.src = revealBaseImage;

    return () => {
      cancelled = true;
    };
  }, [originalQuestionImage, revealBaseImage]);
  const revealCircle =
    effectiveRevealResult?.selected_x_ratio != null && effectiveRevealResult?.selected_y_ratio != null
      ? { xRatio: effectiveRevealResult.selected_x_ratio, yRatio: effectiveRevealResult.selected_y_ratio }
      : null;
  const isResolvingResult = !effectiveRevealResult && !revealNoAnswer;

  /* Banner variant */
  let bannerClass = 'gr-reveal-banner gr-reveal-banner-neutral';
  let resultIcon = '—';
  let resultLabel = 'กำลังดึงผลลัพธ์...';
  let resultSub: string | null = null;

  if (revealNoAnswer) {
    bannerClass = 'gr-reveal-banner gr-reveal-banner-neutral';
    resultIcon = '—';
    resultLabel = 'ไม่ได้ตอบ';
    resultSub = 'คุณไม่ได้ส่งคำตอบสำหรับคำถามนี้';
  } else if (effectiveRevealResult) {
    if (isCorrect) {
      bannerClass = 'gr-reveal-banner gr-reveal-banner-ok';
      resultIcon = '🎯';
      resultLabel = 'ถูกต้อง!';
      resultSub = `+${effectiveRevealResult.score.toLocaleString()} คะแนน`;
    } else {
      bannerClass = 'gr-reveal-banner gr-reveal-banner-bad';
      resultIcon = '✗';
      resultLabel = 'ไม่ถูกต้อง';
      resultSub = 'ไว้ลองใหม่ในข้อหน้า';
    }
  }

  return (
    <div style={{ display: 'flex', minHeight: '100%', flexDirection: 'column', background: 'var(--navy)', position: 'relative' }}>
      {/* Background glows */}
      <div className="gr-glow gr-glow-a" style={{ opacity: .6 }} />
      <div className="gr-glow gr-glow-b" style={{ opacity: .6 }} />

      {/* Result banner */}
      <div className={bannerClass} style={{ position: 'relative', zIndex: 1 }}>
        {isResolvingResult ? (
          <p style={{ fontSize: 13, color: 'var(--text-2)' }}>กำลังดึงผลลัพธ์...</p>
        ) : (
          <>
            <div style={{ fontSize: 26, marginBottom: 6 }}>{resultIcon}</div>
            <div
              style={{
                fontSize: 19, fontWeight: 900,
                color: revealNoAnswer ? 'var(--text-2)' : isCorrect ? 'var(--emerald)' : 'var(--rose)',
              }}
            >
              {resultLabel}
            </div>
            {resultSub && (
              <div
                className="gr-mono"
                style={{
                  fontSize: effectiveRevealResult && isCorrect ? 18 : 11,
                  fontWeight: 900,
                  color: effectiveRevealResult && isCorrect ? 'var(--gold)' : 'var(--text-2)',
                  marginTop: 4,
                }}
              >
                {resultSub}
              </div>
            )}
          </>
        )}
      </div>

      {/* Image area */}
      <div style={{ flex: 1, minHeight: 0, padding: '8px 16px', position: 'relative', zIndex: 1 }}>
        <div className="quiz-image-stage">
          <QuestionImage
            imageUrl={showRevealImage && revealImageReady ? revealBaseImage : originalQuestionImage}
            circleRadiusRatio={question.circle_radius_ratio}
            circle={revealCircle ?? circlePosition}
            onCircleChange={() => {}}
            locked
            maskOverlayClassName={!showRevealImage ? 'reveal-mask-static' : undefined}
            maskOverlayUrl={!showRevealImage ? `${FUNCTIONS_URL}/get-reveal-mask?questionId=${encodeURIComponent(
              question.id
            )}&updatedAt=${encodeURIComponent(gameState?.updated_at ?? '')}` : undefined}
            shellClassName="quiz-image-shell--reveal"
          />
        </div>
      </div>

      {/* Footer */}
      <div
        style={{
          flexShrink: 0,
          borderTop: '1px solid var(--border)',
          background: 'rgba(8,13,28,.75)',
          padding: '8px 18px calc(16px + env(safe-area-inset-bottom, 0px))',
          textAlign: 'center',
          position: 'relative',
          zIndex: 1,
        }}
      >
        <p className="gr-label-xs">กำลังรอตารางคะแนน…</p>
      </div>
    </div>
  );
}
