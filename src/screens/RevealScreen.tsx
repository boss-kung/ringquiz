import { useEffect, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { useRevealResult } from '../hooks/useRevealResult';
import { useGetServerTime } from '../hooks/useServerTime';
import { QuestionImage } from '../components/QuestionImage';
import { FUNCTIONS_URL } from '../lib/supabase';
import { resolveQuestionImageUrl, resolveRevealImageUrl } from '../lib/questionAssets';

export function RevealScreen() {
  useRevealResult();

  const question = useGameStore((s) => s.question);
  const revealResult = useGameStore((s) => s.revealResult);
  const revealNoAnswer = useGameStore((s) => s.revealNoAnswer);
  const circlePosition = useGameStore((s) => s.circlePosition);
  const gameState = useGameStore((s) => s.gameState);
  const getServerTime = useGetServerTime();
  const [showRevealImage, setShowRevealImage] = useState(false);
  const revealStartedAt = gameState?.updated_at ?? null;

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

  if (!question) {
    return (
      <div style={{ display: 'flex', minHeight: '100%', alignItems: 'center', justifyContent: 'center', background: 'var(--navy)' }}>
        <p style={{ color: 'var(--text-2)' }}>กำลังโหลดข้อมูล...</p>
      </div>
    );
  }

  const isCorrect = revealResult?.is_correct ?? false;
  const originalQuestionImage = resolveQuestionImageUrl(question.image_url);
  const revealBaseImage =
    resolveRevealImageUrl(question.reveal_image_url) ??
    resolveQuestionImageUrl(question.image_url);
  const revealCircle =
    revealResult?.selected_x_ratio != null && revealResult?.selected_y_ratio != null
      ? { xRatio: revealResult.selected_x_ratio, yRatio: revealResult.selected_y_ratio }
      : null;

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
  } else if (revealResult) {
    if (isCorrect) {
      bannerClass = 'gr-reveal-banner gr-reveal-banner-ok';
      resultIcon = '🎯';
      resultLabel = 'ถูกต้อง!';
      resultSub = `+${revealResult.score.toLocaleString()} คะแนน`;
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
        {!revealResult && !revealNoAnswer ? (
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
                  fontSize: revealResult && isCorrect ? 18 : 11,
                  fontWeight: 900,
                  color: revealResult && isCorrect ? 'var(--gold)' : 'var(--text-2)',
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
            imageUrl={showRevealImage ? revealBaseImage : originalQuestionImage}
            circleRadiusRatio={question.circle_radius_ratio}
            circle={revealCircle ?? circlePosition}
            onCircleChange={() => {}}
            locked
            maskOverlayClassName="reveal-mask-pulse"
            maskOverlayUrl={`${FUNCTIONS_URL}/get-reveal-mask?questionId=${encodeURIComponent(
              question.id
            )}&updatedAt=${encodeURIComponent(gameState?.updated_at ?? '')}`}
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
          padding: '8px 18px 16px',
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
